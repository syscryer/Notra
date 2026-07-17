import assert from 'node:assert/strict';
import {
  classifyMermaidDiagramSize,
  createMermaidRenderConfig,
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
