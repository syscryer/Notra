type MermaidBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type MermaidDiagramSize = 'wide' | 'balanced' | 'portrait' | 'class';

type MermaidSvgForSizing = Pick<SVGSVGElement, 'classList'>;

let mermaidRenderQueue = Promise.resolve();

export function createMermaidRenderConfig<TTheme extends string>(theme: TTheme) {
    return {
        startOnLoad: false,
        securityLevel: 'strict' as const,
        theme,
        htmlLabels: false,
        flowchart: { htmlLabels: false, curve: 'linear' as const },
        class: { htmlLabels: false },
    };
}

export function classifyMermaidDiagramSize(
    svg: MermaidSvgForSizing,
    width: number,
    height: number,
): MermaidDiagramSize {
    if (svg.classList.contains('classDiagram'))
        return 'class';

    if (svg.classList.contains('erDiagram'))
        return 'wide';

    const ratio = height > 0 ? width / height : 1;
    return ratio >= 1.2 ? 'wide' : ratio >= 0.75 ? 'balanced' : 'portrait';
}

export function mergeMermaidClassTextBounds(
    nativeBox: MermaidBox,
    textBoxes: readonly MermaidBox[],
): MermaidBox {
    if (textBoxes.length === 0)
        return nativeBox;
    const y = Math.min(...textBoxes.map(box => box.y));
    const bottom = Math.max(...textBoxes.map(box => box.y + box.height));
    return {
        x: nativeBox.x,
        y,
        width: Math.max(nativeBox.width, ...textBoxes.map(box => box.width)),
        height: Math.max(nativeBox.height, bottom - y),
    };
}

function translateY(element: SVGGraphicsElement): number {
    return element.transform.baseVal.consolidate()?.matrix.f ?? 0;
}

function measureDirectLabelBoxes(
    group: SVGGElement,
    getBBox: SVGGraphicsElement['getBBox'],
    offsetY = 0,
): MermaidBox[] {
    return [...group.querySelectorAll<SVGGElement>(':scope > g.label')].map((label) => {
        const box = getBBox.call(label);
        return {
            x: box.x,
            y: offsetY + translateY(label) + box.y,
            width: box.width,
            height: box.height,
        };
    });
}

async function withMermaidClassBBoxFix<T>(run: () => Promise<T>): Promise<T> {
    if (
        typeof SVGGraphicsElement === 'undefined'
        || typeof SVGGElement === 'undefined'
        || typeof SVGGraphicsElement.prototype.getBBox !== 'function'
    )
        return run();

    // WebView2 can return a stale parent bbox immediately after Mermaid moves
    // class member groups. Measure each text row so Dagre receives the full height.
    const prototype = SVGGraphicsElement.prototype;
    const nativeGetBBox = prototype.getBBox;
    prototype.getBBox = function patchedGetBBox(this: SVGGraphicsElement): DOMRect {
        if (
            this instanceof SVGGElement
            && this.matches('.members-group, .methods-group')
        ) {
            const nativeBox = nativeGetBBox.call(this);
            const measured = mergeMermaidClassTextBounds(
                nativeBox,
                measureDirectLabelBoxes(this, nativeGetBBox),
            );
            return DOMRect.fromRect(measured);
        }
        if (
            this instanceof SVGGElement
            && this.querySelector(':scope > .label-group')
            && this.querySelector(':scope > .members-group')
        ) {
            const nativeBox = nativeGetBBox.call(this);
            const textBoxes = [...this.children]
                .filter((child): child is SVGGElement =>
                    child instanceof SVGGElement
                    && child.matches('.annotation-group, .label-group, .members-group, .methods-group'),
                )
                .flatMap(group =>
                    measureDirectLabelBoxes(group, nativeGetBBox, translateY(group)),
                );
            const measured = mergeMermaidClassTextBounds(nativeBox, textBoxes);
            return DOMRect.fromRect(measured);
        }
        return nativeGetBBox.call(this);
    };

    try {
        return await run();
    }
    finally {
        prototype.getBBox = nativeGetBBox;
    }
}

/**
 * Mermaid configuration and SVG measurement are global. Serialize every run
 * so editor previews and exports cannot overwrite each other's render state.
 */
export function runMermaidWithCompatibility<T>(run: () => Promise<T>): Promise<T> {
    const task = mermaidRenderQueue.then(() => withMermaidClassBBoxFix(run));
    mermaidRenderQueue = task.then(() => undefined, () => undefined);
    return task;
}
