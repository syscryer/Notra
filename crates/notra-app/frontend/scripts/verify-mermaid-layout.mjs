import assert from 'node:assert/strict';
import {
  classifyMermaidDiagramSize,
  createMermaidRenderConfig,
  inheritMermaidSubgraphDirection,
  mergeMermaidClassTextBounds,
} from '../vendor/marktext-muya/src/utils/diagram/mermaidCompat.ts';

function diagramSvg(type) {
  return {
    classList: { contains: className => className === type },
  };
}

assert.equal(classifyMermaidDiagramSize(diagramSvg('classDiagram'), 386, 1044), 'class');
assert.equal(classifyMermaidDiagramSize(diagramSvg('classDiagram'), 980, 1100), 'class');
assert.equal(classifyMermaidDiagramSize(diagramSvg('erDiagram'), 647, 1157), 'wide');
assert.equal(classifyMermaidDiagramSize(diagramSvg('erDiagram'), 1969, 3598), 'wide');
assert.equal(classifyMermaidDiagramSize(diagramSvg('flowchart'), 400, 900), 'portrait');
assert.equal(classifyMermaidDiagramSize(diagramSvg('flowchart'), 1200, 600), 'wide');

const vertical = [
  'flowchart TD',
  '    subgraph ONE["场景一"]',
  '        A --> B',
  '    end',
].join('\n');
assert.equal(
  inheritMermaidSubgraphDirection(vertical),
  [
    'flowchart TD',
    '    subgraph ONE["场景一"]',
    '        direction TB',
    '        A --> B',
    '    end',
  ].join('\n'),
);

const explicit = [
  'flowchart TD',
  '    subgraph ONE',
  '        direction LR',
  '        A --> B',
  '    end',
].join('\n');
assert.equal(inheritMermaidSubgraphDirection(explicit), explicit);

const nested = [
  'graph TB',
  '    subgraph OUTER',
  '        direction LR',
  '        subgraph INNER',
  '            A --> B',
  '        end',
  '    end',
].join('\n');
assert.equal(
  inheritMermaidSubgraphDirection(nested),
  [
    'graph TB',
    '    subgraph OUTER',
    '        direction LR',
    '        subgraph INNER',
    '            direction LR',
    '            A --> B',
    '        end',
    '    end',
  ].join('\n'),
);

const nonFlowchart = 'sequenceDiagram\n    Alice->>Bob: Hello';
assert.equal(inheritMermaidSubgraphDirection(nonFlowchart), nonFlowchart);

const misleadingSequence = 'sequenceDiagram\n    Alice->>Bob: graph TD\n    subgraph text\n    end';
assert.equal(inheritMermaidSubgraphDirection(misleadingSequence), misleadingSequence);

const malformed = 'flowchart TD\n    subgraph OPEN\n        A --> B';
assert.equal(inheritMermaidSubgraphDirection(malformed), malformed);

const crlf = 'flowchart LR\r\nsubgraph ONE\r\nA --> B\r\nend\r\n';
assert.equal(
  inheritMermaidSubgraphDirection(crlf),
  'flowchart LR\r\nsubgraph ONE\r\n    direction LR\r\nA --> B\r\nend\r\n',
);

assert.deepEqual(createMermaidRenderConfig('dark'), {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'dark',
  htmlLabels: false,
  flowchart: { htmlLabels: false, curve: 'linear' },
  class: { htmlLabels: false },
});

assert.deepEqual(
  mergeMermaidClassTextBounds(
    { x: 0, y: 0, width: 153, height: 18 },
    [
      { x: 0, y: -9, width: 139, height: 18 },
      { x: 0, y: 34, width: 153, height: 105 },
    ],
  ),
  { x: 0, y: -9, width: 153, height: 148 },
);

console.log('Mermaid layout compatibility checks passed.');
