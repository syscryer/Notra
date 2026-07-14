import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import loadRenderer from '../../../utils/diagram';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('diagramPreview:');
let mermaidRenderId = 0;

interface IMermaidRenderJob {
    target: HTMLElement;
    run: () => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
}

const mermaidRenderJobs: IMermaidRenderJob[] = [];
let mermaidRenderRunning = false;

function diagramDistanceFromViewport(target: HTMLElement): number {
    if (!target.isConnected)
        return Number.MAX_SAFE_INTEGER;
    const rect = target.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= window.innerHeight)
        return 0;
    return rect.top > window.innerHeight ? rect.top - window.innerHeight : -rect.bottom;
}

function waitForDiagramRenderOpportunity(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => resolve(), { timeout: 80 });
        }
        else {
            window.requestAnimationFrame(() => resolve());
        }
    });
}

async function drainMermaidRenderQueue(): Promise<void> {
    if (mermaidRenderRunning)
        return;
    mermaidRenderRunning = true;
    try {
        while (mermaidRenderJobs.length > 0) {
            await waitForDiagramRenderOpportunity();
            mermaidRenderJobs.sort(
                (left, right) => diagramDistanceFromViewport(left.target) - diagramDistanceFromViewport(right.target),
            );
            const job = mermaidRenderJobs.shift()!;
            if (!job.target.isConnected) {
                job.resolve();
                continue;
            }
            try {
                await job.run();
                job.resolve();
            }
            catch (error) {
                job.reject(error);
            }
        }
    }
    finally {
        mermaidRenderRunning = false;
        if (mermaidRenderJobs.length > 0)
            void drainMermaidRenderQueue();
    }
}

function scheduleMermaidRender(target: HTMLElement, run: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
        mermaidRenderJobs.push({ target, run, resolve, reject });
        void drainMermaidRenderQueue();
    });
}

function applyDiagramSizeClass(svg: SVGSVGElement, width: number, height: number): void {
    svg.classList.remove('mu-diagram-wide', 'mu-diagram-balanced', 'mu-diagram-portrait');
    const ratio = height > 0 ? width / height : 1;
    svg.classList.add(
        ratio >= 1.2 || width >= 900
            ? 'mu-diagram-wide'
            : ratio >= 0.75
                ? 'mu-diagram-balanced'
                : 'mu-diagram-portrait',
    );
}

function compactDisconnectedMermaidRoots(svg: SVGSVGElement, code: string): boolean {
    const direction = code.match(/^\s*(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/im)?.[1];
    const graphRoot = svg.querySelector<SVGGElement>('g.root');
    const nodes = graphRoot?.querySelector<SVGGElement>(':scope > g.nodes');
    if (!direction || !graphRoot || !nodes)
        return false;

    const edgePaths = graphRoot.querySelector<SVGGElement>(':scope > g.edgePaths');
    if (edgePaths?.querySelector('path'))
        return false;

    const roots = Array.from(nodes.children).filter(
        (child): child is SVGGElement => child instanceof SVGGElement && child.classList.contains('root'),
    );
    if (roots.length < 2)
        return false;

    const subgraphIds = Array.from(code.matchAll(/^\s*subgraph\s+([A-Za-z0-9_-]+)/gim), match => match[1]);
    roots.sort((left, right) => {
        const sourceIndex = (root: SVGGElement) => {
            const clusterId = root.querySelector<SVGGElement>('g.cluster[id]')?.id ?? '';
            const index = subgraphIds.findIndex(id => clusterId.endsWith(`-${id}`));
            return index < 0 ? Number.MAX_SAFE_INTEGER : index;
        };
        return sourceIndex(left) - sourceIndex(right);
    });

    const boxes = roots.map(root => root.getBBox());
    const gap = 48;
    const vertical = direction === 'TD' || direction === 'TB' || direction === 'BT';
    const expectedWidth = vertical
        ? Math.max(...boxes.map(box => box.width))
        : boxes.reduce((total, box) => total + box.width, 0) + gap * (boxes.length - 1);
    const expectedHeight = vertical
        ? boxes.reduce((total, box) => total + box.height, 0) + gap * (boxes.length - 1)
        : Math.max(...boxes.map(box => box.height));
    const currentBounds = nodes.getBBox();
    if (currentBounds.width <= expectedWidth * 2.5 && currentBounds.height <= expectedHeight * 2.5)
        return false;

    const inset = 8;
    let offset = inset;
    roots.forEach((root, index) => {
        const box = boxes[index];
        const x = vertical ? inset + (expectedWidth - box.width) / 2 : offset;
        const y = vertical ? offset : inset + (expectedHeight - box.height) / 2;
        root.setAttribute('transform', `translate(${x - box.x}, ${y - box.y})`);
        offset += (vertical ? box.height : box.width) + gap;
    });
    return true;
}

// Give a fixed-size `<svg>` a viewBox when needed, then classify its aspect
// ratio so the host can enlarge compact diagrams without stretching tall ones
// across the whole editor.
function finalizeSvg(target: HTMLElement, tightenViewBox = false): boolean {
    const svg = target.querySelector('svg');
    if (!svg)
        return false;
    const viewBox = svg.viewBox.baseVal;
    let width = viewBox.width || Number.parseFloat(svg.getAttribute('width') ?? '');
    let height = viewBox.height || Number.parseFloat(svg.getAttribute('height') ?? '');
    if (tightenViewBox) {
        const graph = svg.querySelector<SVGGElement>(':scope > g');
        const bounds = graph && typeof graph.getBBox === 'function' ? graph.getBBox() : null;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            const padding = 16;
            width = bounds.width + padding * 2;
            height = bounds.height + padding * 2;
            svg.setAttribute(
                'viewBox',
                `${bounds.x - padding} ${bounds.y - padding} ${width} ${height}`,
            );
            svg.style.maxWidth = `${Math.ceil(width)}px`;
        }
    }
    if (width > 0 && height > 0) {
        if (!svg.getAttribute('viewBox'))
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        applyDiagramSizeClass(svg, width, height);
        return true;
    }
    return false;
}

// `drawSVG` (js-sequence-diagrams / flowchart.js) renders the `<svg>`
// asynchronously — it's drawn from a theme callback after its font loads — so
// the element and its `width`/`height` attributes aren't there synchronously.
// Try once, then observe `target` until the sized `<svg>` appears.
function ensureViewBox(target: HTMLElement): void {
    if (finalizeSvg(target))
        return;
    const observer = new MutationObserver(() => {
        if (finalizeSvg(target))
            observer.disconnect();
    });
    observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['width', 'height'],
    });
    // Safety net so the observer can't leak if the svg never renders.
    setTimeout(() => observer.disconnect(), 5000);
}

interface IRenderOptions {
    type: string;
    code: string;
    target: HTMLElement;
    vegaTheme: string;
    mermaidTheme: string;
    plantumlServer: string;
    sequenceTheme: 'hand' | 'simple';
}

async function renderDiagram({
    type,
    code,
    target,
    vegaTheme,
    mermaidTheme,
    plantumlServer,
    sequenceTheme,
}: IRenderOptions) {
    if (type === 'mermaid') {
        await scheduleMermaidRender(target, async () => {
            const render = await loadRenderer(type);
            render.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: mermaidTheme,
            });
            const id = `muya-mermaid-${Date.now()}-${++mermaidRenderId}`;
            const { svg, bindFunctions } = await render.render(id, code);
            target.innerHTML = svg;
            bindFunctions?.(target);
            const renderedSvg = target.querySelector<SVGSVGElement>('svg');
            const compacted = renderedSvg
                ? compactDisconnectedMermaidRoots(renderedSvg, code)
                : false;
            finalizeSvg(target, compacted);
        });
        return;
    }

    const render = await loadRenderer(type);
    const options = {};
    if (type === 'vega-lite') {
        Object.assign(options, {
            actions: false,
            tooltip: false,
            renderer: 'svg',
            theme: vegaTheme,
            ast: true,
        });
    }
    else if (type === 'sequence') {
        Object.assign(options, { theme: sequenceTheme });
    }

    if (type === 'plantuml') {
        const diagram = render.parse(code, plantumlServer);
        target.innerHTML = '';
        diagram.insertImgElement(target);
    }
    else if (type === 'vega-lite') {
        await render(target, JSON.parse(code), options);
        finalizeSvg(target);
    }
    else if (type === 'flowchart' || type === 'sequence') {
        const diagram = render.parse(code);
        target.innerHTML = '';
        diagram.drawSVG(target, options);
        // js-sequence-diagrams / flowchart.js emit an <svg> with a fixed pixel
        // width/height but NO viewBox, so the `max-width: 100%` style can only
        // clip a wide diagram, not scale it. Derive a viewBox from those pixel
        // dimensions (once the async draw completes) so it scales to fit.
        ensureViewBox(target);
    }
}

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        clickObservable.subscribe(this.clickHandler.bind(this));
    }

    clickHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.parent == null)
            return;

        const cursorBlock = this.parent.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    async update(code = this._code) {
        const { i18n } = this.muya;
        if (this._code !== code)
            this._code = code;

        if (code) {
            this.domNode!.innerHTML = i18n.t('Loading...');
            const { mermaidTheme, vegaTheme, plantumlServer, sequenceTheme } = this.muya.options;
            const { _type: type } = this;

            try {
                await renderDiagram({
                    target: this.domNode!,
                    code,
                    type,
                    mermaidTheme,
                    vegaTheme,
                    plantumlServer,
                    sequenceTheme,
                });
            }
            catch (error) {
                const detail
                    = error instanceof Error ? error.message : String(error);
                debug.error(`render ${type} diagram failed: ${detail}`);
                this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; ${i18n.t(
                    'Invalid Diagram Code',
                )} &gt;<div class="mu-diagram-error-detail">${sanitize(
                    detail,
                    PREVIEW_DOMPURIFY_CONFIG,
                    true,
                )}</div></div>`;
            }
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Diagram',
            )} &gt;</div>`;
        }
    }
}

export default DiagramPreview;
