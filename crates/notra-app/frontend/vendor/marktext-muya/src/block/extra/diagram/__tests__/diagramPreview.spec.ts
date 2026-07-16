// @vitest-environment happy-dom
import type { Muya } from '../../../../muya';
import type { IDiagramMeta, IDiagramState } from '../../../../state/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../../../config';
import I18n from '../../../../i18n';
import { en } from '../../../../locales/en';
import { zhCN } from '../../../../locales/zh-CN';
import DiagramPreview from '../diagramPreview';

// The diagram renderer (`utils/diagram` default export) dynamically imports
// heavy renderer packages (mermaid / vega / flowchart) that don't load under
// happy-dom. We mock it so:
//   - the "valid" path never runs (we only characterize empty + error states),
//   - the "invalid" path can throw a controlled message we assert is sanitized.
const loadRendererMock = vi.fn();
vi.mock('../../../../utils/diagram', () => ({
    default: (...args: unknown[]) => loadRendererMock(...args),
}));

const bootedHosts: HTMLElement[] = [];

afterEach(() => {
    while (bootedHosts.length) bootedHosts.pop()!.remove();
    loadRendererMock.mockReset();
});

// Build a structurally-typed fake `Muya` carrying only what DiagramPreview
// touches: an `i18n` with `.t(key)` and `options` with the diagram themes.
function makeFakeMuya(locale = en): { muya: Muya; i18n: I18n } {
    const muya = {
        options: {
            mermaidTheme: 'default',
            vegaTheme: 'default',
            sequenceTheme: 'hand',
        },
    } as unknown as Muya;
    const i18n = new I18n(muya, locale);
    (muya as unknown as { i18n: I18n }).i18n = i18n;
    return { muya, i18n };
}

function makeState(text: string, type: IDiagramMeta['type'] = 'mermaid'): IDiagramState {
    return {
        name: 'diagram',
        text,
        meta: { lang: 'yaml', type },
    };
}

// DiagramPreview's constructor fires `update()` unawaited. To get a
// deterministic DOM, construct it, then await our own `update()` call.
function makePreview(text: string, type: IDiagramMeta['type'] = 'mermaid', locale = en) {
    const { muya, i18n } = makeFakeMuya(locale);
    const preview = new DiagramPreview(muya, makeState(text, type));
    document.body.append(preview.domNode!);
    bootedHosts.push(preview.domNode!);
    return { preview, muya, i18n };
}

describe('diagramPreview — empty state', () => {
    it('renders the empty-state class + localized "Empty Diagram" for empty code', async () => {
        const { preview } = makePreview('');
        await preview.update('');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain(`class="${CLASS_NAMES.MU_EMPTY}"`);
        expect(CLASS_NAMES.MU_EMPTY).toBe('mu-empty');
        expect(html).toContain('Empty Diagram');
    });

    it('localizes the empty-state label via i18n (zh-CN)', async () => {
        const { preview } = makePreview('', 'mermaid', zhCN);
        await preview.update('');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain(`class="${CLASS_NAMES.MU_EMPTY}"`);
        expect(html).toContain('空图表');
    });
});

describe('diagramPreview — invalid / error state', () => {
    it('renders the error class + localized "Invalid Diagram Code" when the renderer throws', async () => {
        loadRendererMock.mockRejectedValue(new Error('Unknown diagram name mermaid'));
        const { preview } = makePreview('graph TD; A-->B');
        await preview.update('graph TD; A-->B');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain('class="mu-diagram-error"');
        expect(html).toContain('Invalid Diagram Code');
        expect(html).toContain('class="mu-diagram-error-detail"');
        expect(html).toContain('Unknown diagram name mermaid');
    });

    it('sanitizes the error detail (escapes embedded HTML so no raw tag survives)', async () => {
        loadRendererMock.mockRejectedValue(new Error('boom <img src=x onerror=alert(1)>'));
        const { preview } = makePreview('graph TD; A-->B');
        await preview.update('graph TD; A-->B');

        const detail = preview.domNode!.querySelector('.mu-diagram-error-detail')!;
        expect(detail).not.toBeNull();
        // No live <img> element should be parsed into the DOM — the tag was escaped.
        expect(detail.querySelector('img')).toBeNull();
        expect(preview.domNode!.querySelector('img')).toBeNull();
        // The escaped text is still present as text content.
        expect(detail.textContent).toContain('boom');
    });

    it('localizes the error label via i18n (zh-CN)', async () => {
        loadRendererMock.mockRejectedValue(new Error('nope'));
        const { preview } = makePreview('graph TD; A-->B', 'mermaid', zhCN);
        await preview.update('graph TD; A-->B');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain('class="mu-diagram-error"');
        expect(html).toContain('图表渲染失败');
    });
});

describe('diagramPreview — mermaid SVG ownership', () => {
    it('normalizes the Mermaid viewBox to its graph bounds without rerendering', async () => {
        const run = vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
            nodes[0].innerHTML = '<svg viewBox="-138 -83 2146 2091"><g class="root"></g></svg>';
            nodes[0].querySelector<SVGGElement>('g.root')!.getBBox = () => ({
                x: 8,
                y: 8,
                width: 509,
                height: 1758,
            } as DOMRect);
        });
        loadRendererMock.mockResolvedValue({ initialize: vi.fn(), run });

        const { preview } = makePreview('');
        await preview.update('flowchart TD\nA --> B');

        expect(run).toHaveBeenCalledTimes(1);
        expect(preview.domNode!.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 525 1774');
    });

    it('waits for document fonts before Mermaid measures the connected preview', async () => {
        let resolveFonts!: () => void;
        const fontsReady = new Promise<void>((resolve) => {
            resolveFonts = resolve;
        });
        const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: fontsReady },
        });
        const initialize = vi.fn();
        const run = vi.fn(async () => undefined);
        loadRendererMock.mockResolvedValue({ initialize, run });

        try {
            const code = 'flowchart TD\nA --> B';
            const { preview } = makePreview(code);
            const update = preview.update(code);
            await Promise.resolve();
            expect(run).not.toHaveBeenCalled();

            resolveFonts();
            await update;
            expect(run).toHaveBeenCalled();
        }
        finally {
            if (originalFonts)
                Object.defineProperty(document, 'fonts', originalFonts);
            else
                Reflect.deleteProperty(document, 'fonts');
        }
    });

    it('renders in the connected preview node so Mermaid measures final DOM geometry', async () => {
        const initialize = vi.fn();
        const run = vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
            expect(nodes).toHaveLength(1);
            expect(nodes[0].isConnected).toBe(true);
            expect(nodes[0].textContent).toContain('subgraph TARGET');
            nodes[0].innerHTML = [
                '<svg viewBox="0 0 3986 1915">',
                '<g class="root" transform="translate(8, 8)"></g>',
                '</svg>',
            ].join('');
        });
        loadRendererMock.mockResolvedValue({ initialize, run });

        const code = [
            'flowchart TB',
            'subgraph TARGET["Data"]',
            'A["A"]',
            'end',
            'SOURCE --> TARGET',
        ].join('\n');
        const { preview } = makePreview(code);
        await preview.update(code);

        expect(initialize).toHaveBeenLastCalledWith({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'default',
            htmlLabels: false,
            flowchart: { htmlLabels: false },
        });
        expect(run).toHaveBeenCalled();
        const svg = preview.domNode!.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 3986 1915');
        expect(svg.querySelector('g.root')!.getAttribute('transform')).toBe('translate(8, 8)');
    });
});

describe('diagramPreview — clickHandler routing', () => {
    it('preventDefault + stopPropagation + setCursor(0,0) on the parent first content', () => {
        const { preview } = makePreview('');
        const setCursor = vi.fn();
        const cursorBlock = { setCursor };
        const parent = {
            firstContentInDescendant: vi.fn(() => cursorBlock),
        };
        // parent is typed as Parent | null; the fake only implements what
        // clickHandler calls.
        preview.parent = parent as unknown as DiagramPreview['parent'];

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        preview.clickHandler(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(parent.firstContentInDescendant).toHaveBeenCalledTimes(1);
        expect(setCursor).toHaveBeenCalledWith(0, 0);
    });

    it('still preventDefault/stopPropagation but does not throw when parent is null', () => {
        const { preview } = makePreview('');
        preview.parent = null;

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        expect(() => preview.clickHandler(event)).not.toThrow();
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('does not throw when parent has no content (firstContentInDescendant returns null)', () => {
        const { preview } = makePreview('');
        const parent = {
            firstContentInDescendant: vi.fn(() => null),
        };
        preview.parent = parent as unknown as DiagramPreview['parent'];

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        expect(() => preview.clickHandler(event)).not.toThrow();
        expect(parent.firstContentInDescendant).toHaveBeenCalledTimes(1);
    });
});

// Pins that the diagram-theme options flow from muya.options through
// renderDiagram into the underlying renderer call (not just that the
// default options carry the right value — diagramFlowchartSequence.spec
// only asserts MUYA_DEFAULT_OPTIONS.sequenceTheme === 'hand').
describe('diagramPreview — renderer theme pass-through', () => {
    // The constructor fires update() unawaited, so assert on lastCall — our
    // explicit update() (after mutating the option) is always the latest.
    it('passes sequenceTheme into the sequence renderer drawSVG options (simple)', async () => {
        const drawSVG = vi.fn();
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG }) });

        const { preview, muya } = makePreview('Alice->Bob: Hi', 'sequence');
        muya.options.sequenceTheme = 'simple';
        await preview.update('Alice->Bob: Hi');

        expect(drawSVG).toHaveBeenCalled();
        expect(drawSVG.mock.lastCall![1]).toMatchObject({ theme: 'simple' });
    });

    it('defaults sequenceTheme to the muya option value (hand) when unchanged', async () => {
        const drawSVG = vi.fn();
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG }) });

        const { preview } = makePreview('Alice->Bob: Hi', 'sequence');
        await preview.update('Alice->Bob: Hi');

        expect(drawSVG).toHaveBeenCalled();
        expect(drawSVG.mock.lastCall![1]).toMatchObject({ theme: 'hand' });
    });

    it('passes vegaTheme + ast:true into the vega-lite renderer options', async () => {
        const render = vi.fn();
        loadRendererMock.mockResolvedValue(render);

        const { preview, muya } = makePreview('{}', 'vega-lite');
        muya.options.vegaTheme = 'dark';
        await preview.update('{"mark":"bar"}');

        expect(render).toHaveBeenCalled();
        expect(render.mock.lastCall![2]).toMatchObject({
            theme: 'dark',
            ast: true,
            actions: false,
            tooltip: false,
            renderer: 'svg',
        });
    });
});
