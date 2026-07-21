import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import loadRenderer from '../../../utils/diagram';
import {
    classifyMermaidDiagramSize,
    createMermaidRenderConfig,
    repairDisconnectedMermaidClusterEdges,
    runMermaidWithCompatibility,
} from '../../../utils/diagram/mermaidCompat';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('diagramPreview:');

interface IMermaidRenderJob {
    target: HTMLElement;
    run: () => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
}

const mermaidRenderJobs: IMermaidRenderJob[] = [];
let mermaidRenderRunning = false;
let mermaidRenderWakeFrame = 0;
let mermaidRenderWakeListenersReady = false;

function diagramRenderViewport(target: HTMLElement): { top: number; bottom: number; height: number } {
    const pane = target.closest<HTMLElement>('.markdown-editor-pane');
    if (pane) {
        const rect = pane.getBoundingClientRect();
        const height = rect.height || pane.clientHeight;
        if (height > 0)
            return { top: rect.top, bottom: rect.bottom, height };
    }
    const height = Math.max(1, window.innerHeight);
    return { top: 0, bottom: height, height };
}

function diagramDistanceFromViewport(target: HTMLElement): number {
    if (!target.isConnected || target.closest('[aria-hidden="true"]'))
        return Number.MAX_SAFE_INTEGER;
    const rect = target.getBoundingClientRect();
    const viewport = diagramRenderViewport(target);
    if (rect.bottom >= viewport.top && rect.top <= viewport.bottom)
        return 0;
    return rect.top > viewport.bottom ? rect.top - viewport.bottom : viewport.top - rect.bottom;
}

function diagramIsNearViewport(target: HTMLElement): boolean {
    const distance = diagramDistanceFromViewport(target);
    return distance <= Math.max(800, diagramRenderViewport(target).height * 1.5);
}

function requestMermaidRenderDrain(): void {
    if (mermaidRenderJobs.length === 0 || mermaidRenderWakeFrame)
        return;
    mermaidRenderWakeFrame = window.requestAnimationFrame(() => {
        mermaidRenderWakeFrame = 0;
        void drainMermaidRenderQueue();
    });
}

function ensureMermaidRenderWakeListeners(): void {
    if (mermaidRenderWakeListenersReady)
        return;
    mermaidRenderWakeListenersReady = true;
    document.addEventListener('scroll', requestMermaidRenderDrain, true);
    window.addEventListener('resize', requestMermaidRenderDrain);
    new MutationObserver(requestMermaidRenderDrain).observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-hidden'],
    });
}

function takeNextMermaidRenderJob(): IMermaidRenderJob | null {
    for (let index = mermaidRenderJobs.length - 1; index >= 0; index -= 1) {
        const job = mermaidRenderJobs[index];
        if (!job.target.isConnected) {
            mermaidRenderJobs.splice(index, 1);
            job.resolve();
        }
    }

    let nextIndex = -1;
    let nextDistance = Number.MAX_SAFE_INTEGER;
    mermaidRenderJobs.forEach((job, index) => {
        if (!diagramIsNearViewport(job.target))
            return;
        const distance = diagramDistanceFromViewport(job.target);
        if (distance < nextDistance) {
            nextIndex = index;
            nextDistance = distance;
        }
    });
    return nextIndex >= 0 ? mermaidRenderJobs.splice(nextIndex, 1)[0] : null;
}

export function cancelPendingDiagramRenders(root: Node): void {
    for (let index = mermaidRenderJobs.length - 1; index >= 0; index -= 1) {
        const job = mermaidRenderJobs[index];
        if (job.target === root || root.contains(job.target)) {
            mermaidRenderJobs.splice(index, 1);
            job.resolve();
        }
    }
}

async function waitForDiagramRenderOpportunity(): Promise<void> {
    if (document.readyState !== 'complete') {
        await new Promise<void>((resolve) => {
            window.addEventListener('load', () => resolve(), { once: true });
        });
    }
    if (document.fonts)
        await document.fonts.ready;
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => {
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
            const job = takeNextMermaidRenderJob();
            if (!job)
                return;
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
    ensureMermaidRenderWakeListeners();
    return new Promise((resolve, reject) => {
        mermaidRenderJobs.push({ target, run, resolve, reject });
        void drainMermaidRenderQueue();
    });
}

function applyDiagramSizeClass(svg: SVGSVGElement, width: number, height: number): void {
    svg.classList.remove(
        'mu-diagram-wide',
        'mu-diagram-balanced',
        'mu-diagram-portrait',
        'mu-diagram-class',
    );
    svg.classList.add(`mu-diagram-${classifyMermaidDiagramSize(svg, width, height)}`);
}

function normalizeMermaidViewBox(target: HTMLElement): boolean {
    const svg = target.querySelector<SVGSVGElement>('svg');
    const root = svg?.querySelector<SVGGElement>('g.root');
    if (!svg || !root)
        return false;
    let bounds: DOMRect | SVGRect;
    try {
        bounds = root.getBBox();
    }
    catch {
        return false;
    }
    if (
        ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        || bounds.width <= 0
        || bounds.height <= 0
    )
        return false;
    const padding = 8;
    const width = bounds.width + padding * 2;
    const height = bounds.height + padding * 2;
    svg.setAttribute(
        'viewBox',
        `${bounds.x - padding} ${bounds.y - padding} ${width} ${height}`,
    );
    applyDiagramSizeClass(svg, width, height);
    return true;
}

async function renderMermaidInTarget(
    render: { run: (options: { nodes: HTMLElement[] }) => Promise<void> },
    target: HTMLElement,
    code: string,
): Promise<void> {
    target.innerHTML = sanitize(code, PREVIEW_DOMPURIFY_CONFIG, true) as string;
    target.removeAttribute('data-processed');
    await render.run({ nodes: [target] });
    repairDisconnectedMermaidClusterEdges(target, code);
    normalizeMermaidViewBox(target);
}

// Give a fixed-size `<svg>` a viewBox when needed, then classify its aspect
// ratio so the host can enlarge compact diagrams without stretching tall ones
// across the whole editor.
function finalizeSvg(target: HTMLElement): boolean {
    const svg = target.querySelector('svg');
    if (!svg)
        return false;
    const viewBox = svg.viewBox.baseVal;
    const width = viewBox.width || Number.parseFloat(svg.getAttribute('width') ?? '');
    const height = viewBox.height || Number.parseFloat(svg.getAttribute('height') ?? '');
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
            await runMermaidWithCompatibility(async () => {
                render.initialize(createMermaidRenderConfig(mermaidTheme, code));
                await renderMermaidInTarget(render, target, code);
            });
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
