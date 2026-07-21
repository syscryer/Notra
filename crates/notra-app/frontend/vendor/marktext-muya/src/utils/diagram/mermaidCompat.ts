type MermaidBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type MermaidPoint = {
    x: number;
    y: number;
};

export type MermaidDiagramSize = 'wide' | 'balanced' | 'portrait' | 'class';

type MermaidSvgForSizing = Pick<SVGSVGElement, 'classList'>;

let mermaidRenderQueue = Promise.resolve();

function firstMermaidStatement(source: string): string {
    let inFrontmatter = false;
    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '---') {
            inFrontmatter = !inFrontmatter;
            continue;
        }
        if (inFrontmatter || !trimmed || trimmed.startsWith('%%'))
            continue;
        return trimmed;
    }
    return '';
}

export function shouldUseTyporaFlowchartRendering(source: string): boolean {
    if (!/^(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/i.test(firstMermaidStatement(source)))
        return false;

    const subgraphCount = source.match(/^\s*subgraph\b/gim)?.length ?? 0;
    const lineCount = source.split(/\r?\n/).length;
    return subgraphCount >= 3 && lineCount >= 40;
}

export function shouldInheritDisconnectedSubgraphDirection(source: string): boolean {
    if (!/^(?:flowchart|graph)\s+(?:TB|TD)\b/i.test(firstMermaidStatement(source)))
        return false;
    if (/^\s*direction\s+(?:TB|TD|BT|LR|RL)\b/im.test(source))
        return false;

    let subgraphDepth = 0;
    let subgraphCount = 0;
    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (/^subgraph\b/i.test(trimmed)) {
            subgraphDepth += 1;
            subgraphCount += 1;
            continue;
        }
        if (/^end\s*$/i.test(trimmed)) {
            subgraphDepth = Math.max(0, subgraphDepth - 1);
            continue;
        }
        if (
            subgraphDepth === 0
            && /(?:-->|---|-.->|==>)/.test(trimmed)
        ) return false;
    }
    return subgraphCount >= 2;
}

export function createMermaidRenderConfig<TTheme extends string>(theme: TTheme, source = '') {
    const typoraFlowchart = shouldUseTyporaFlowchartRendering(source);
    const inheritDisconnectedSubgraphs = shouldInheritDisconnectedSubgraphDirection(source);
    return {
        startOnLoad: false,
        securityLevel: 'strict' as const,
        theme,
        htmlLabels: false,
        flowchart: {
            // WebView2 can misplace large subgraphs when foreignObject labels
            // participate in Dagre measurement, so keep stable SVG labels.
            htmlLabels: false,
            curve: typoraFlowchart ? 'basis' as const : 'linear' as const,
            ...(inheritDisconnectedSubgraphs ? { inheritDir: true } : {}),
        },
        class: { htmlLabels: false },
    };
}

function transformPoint(matrix: DOMMatrix, point: MermaidPoint): MermaidPoint {
    return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
}

function clusterBoundsInPathSpace(
    rect: SVGRectElement,
    path: SVGPathElement,
): MermaidBox | null {
    const clusterMatrix = rect.getCTM();
    const pathMatrix = path.getCTM();
    if (!clusterMatrix || !pathMatrix)
        return null;

    let inversePathMatrix: DOMMatrix;
    let box: DOMRect | SVGRect;
    try {
        inversePathMatrix = pathMatrix.inverse();
        box = rect.getBBox();
    }
    catch {
        return null;
    }

    const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x, y: box.y + box.height },
        { x: box.x + box.width, y: box.y + box.height },
    ].map(point => transformPoint(
        inversePathMatrix,
        transformPoint(clusterMatrix, point),
    ));
    const left = Math.min(...corners.map(point => point.x));
    const top = Math.min(...corners.map(point => point.y));
    const right = Math.max(...corners.map(point => point.x));
    const bottom = Math.max(...corners.map(point => point.y));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function distanceFromBoxBoundary(point: MermaidPoint, box: MermaidBox): number {
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const outsideX = Math.max(box.x - point.x, 0, point.x - right);
    const outsideY = Math.max(box.y - point.y, 0, point.y - bottom);
    if (outsideX > 0 || outsideY > 0)
        return Math.hypot(outsideX, outsideY);
    return Math.min(point.x - box.x, right - point.x, point.y - box.y, bottom - point.y);
}

function lineToBoxBoundary(
    start: MermaidPoint,
    box: MermaidBox,
): MermaidPoint | null {
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const dx = center.x - start.x;
    const dy = center.y - start.y;
    const candidates: Array<{ point: MermaidPoint; t: number }> = [];
    const epsilon = 0.001;

    if (Math.abs(dx) > epsilon) {
        for (const x of [box.x, right]) {
            const t = (x - start.x) / dx;
            const y = start.y + t * dy;
            if (t > 0 && t <= 1 && y >= box.y - epsilon && y <= bottom + epsilon)
                candidates.push({ point: { x, y }, t });
        }
    }
    if (Math.abs(dy) > epsilon) {
        for (const y of [box.y, bottom]) {
            const t = (y - start.y) / dy;
            const x = start.x + t * dx;
            if (t > 0 && t <= 1 && x >= box.x - epsilon && x <= right + epsilon)
                candidates.push({ point: { x, y }, t });
        }
    }
    candidates.sort((a, b) => a.t - b.t);
    const intersection = candidates[0]?.point;
    if (!intersection)
        return null;

    // Mermaid's pointEnd marker reaches roughly four units beyond the path.
    const length = Math.hypot(intersection.x - start.x, intersection.y - start.y);
    if (length <= 4)
        return intersection;
    return {
        x: intersection.x - (intersection.x - start.x) * 4 / length,
        y: intersection.y - (intersection.y - start.y) * 4 / length,
    };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mermaid 11 can move a nested cluster after Dagre has routed its incoming
 * edges in WebView2. Repair only visibly detached endpoints on large,
 * multi-cluster flowcharts; correctly routed diagrams remain byte-identical.
 */
export function repairDisconnectedMermaidClusterEdges(
    target: HTMLElement,
    source: string,
): number {
    if (!shouldUseTyporaFlowchartRendering(source))
        return 0;
    const svg = target.querySelector<SVGSVGElement>('svg');
    if (!svg?.id)
        return 0;

    let repairCount = 0;
    const idPrefix = `${svg.id}-`;
    for (const cluster of svg.querySelectorAll<SVGGElement>('g.cluster')) {
        const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
        if (!rect)
            continue;
        const clusterKey = cluster.id.startsWith(idPrefix)
            ? cluster.id.slice(idPrefix.length)
            : cluster.id;
        const incomingEdgePattern = new RegExp(`_${escapeRegExp(clusterKey)}_\\d+$`);

        for (const path of svg.querySelectorAll<SVGPathElement>('path.flowchart-link')) {
            if (
                path.dataset.notraClusterEdgeRepaired === 'true'
                || !path.getAttribute('marker-end')
                || !incomingEdgePattern.test(path.id)
            ) continue;
            const bounds = clusterBoundsInPathSpace(rect, path);
            if (!bounds)
                continue;
            const pathLength = path.getTotalLength();
            const start = path.getPointAtLength(0);
            const end = path.getPointAtLength(pathLength);
            if (distanceFromBoxBoundary(end, bounds) <= 12)
                continue;
            const repairedEnd = lineToBoxBoundary(start, bounds);
            const pathData = path.getAttribute('d');
            if (!repairedEnd || !pathData)
                continue;
            path.setAttribute('d', `${pathData}L${repairedEnd.x},${repairedEnd.y}`);
            path.dataset.notraClusterEdgeRepaired = 'true';
            repairCount += 1;
        }
    }
    return repairCount;
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
