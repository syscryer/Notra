import type CellBlock from '../../block/gfm/table/cell';
import type Table from '../../block/gfm/table';
import type { Muya } from '../../index';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    EllipsisVertical,
    Table2,
    Trash2,
    createElement as createLucideElement,
} from 'lucide';
import { EVENT_KEYS } from '../../config';
import { isHTMLElement, isKeyboardEvent } from '../../utils';
import BaseFloat from '../baseFloat';

import './index.css';

const defaultOptions = {
    placement: 'top-start' as const,
    offsetOptions: {
        mainAxis: 2,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

type TableToolAction
    = | 'resize'
        | 'align-left'
        | 'align-center'
        | 'align-right'
        | 'more'
        | 'remove';

const TOOLS = [
    { action: 'resize', title: '调整表格尺寸', icon: Table2, side: 'left' },
    { action: 'align-left', title: '左对齐当前列', icon: AlignLeft, side: 'left' },
    { action: 'align-center', title: '居中对齐当前列', icon: AlignCenter, side: 'left' },
    { action: 'align-right', title: '右对齐当前列', icon: AlignRight, side: 'left' },
    { action: 'more', title: '更多表格操作', icon: EllipsisVertical, side: 'right' },
    { action: 'remove', title: '删除表格', icon: Trash2, side: 'right' },
] as const;

export class TableColumnToolbar extends BaseFloat {
    static pluginName = 'tableColumnTools';
    public override capturesContentKeydown = true;

    private _block: CellBlock | null = null;
    private _table: Table | null = null;
    private readonly _buttons = new Map<TableToolAction, HTMLButtonElement>();
    private readonly _leftGroup = document.createElement('div');
    private readonly _rightGroup = document.createElement('div');

    constructor(muya: Muya, options = {}) {
        const name = 'mu-table-column-tools';
        const opts = Object.assign({}, defaultOptions, options);
        super(muya, name, opts);
        this.floatBox!.classList.add('mu-table-column-tools-container');
        this._leftGroup.className = 'mu-table-tools-group mu-table-tools-left';
        this._rightGroup.className = 'mu-table-tools-group mu-table-tools-right';
        this.container!.append(this._leftGroup, this._rightGroup);
        this.render();
        this.listen();
    }

    override listen() {
        const { eventCenter, domNode } = this.muya;

        eventCenter.subscribe('selection-change', ({ anchorBlock }) => {
            const cell = anchorBlock?.closestBlock?.('table.cell') as CellBlock | null;
            if (!cell?.parent || !cell.table.parent) {
                this.hide();
                return;
            }
            this._showForCell(cell);
        });

        eventCenter.attachDOMEvent(document, 'pointerdown', (event) => {
            if (!isHTMLElement(event.target))
                return;
            if (this.floatBox?.contains(event.target) || this._table?.domNode?.contains(event.target))
                return;
            this.hide();
        });
        eventCenter.attachDOMEvent(domNode, 'keydown', (event) => {
            if (isKeyboardEvent(event) && event.key === EVENT_KEYS.Escape)
                this.hide();
        });
        eventCenter.attachDOMEvent(this.floatBox!, 'mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        eventCenter.attachDOMEvent(this.floatBox!, 'click', (event) => {
            event.stopPropagation();
        });
    }

    render() {
        for (const tool of TOOLS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `mu-table-tool-button mu-table-tool-${tool.action}`;
            button.title = tool.title;
            button.setAttribute('aria-label', tool.title);
            const icon = createLucideElement(tool.icon, {
                width: '12',
                height: '12',
                'stroke-width': '1.8',
                'aria-hidden': 'true',
            });
            button.appendChild(icon);
            button.addEventListener('click', event => this._runAction(event, tool.action));
            this._buttons.set(tool.action, button);
            (tool.side === 'left' ? this._leftGroup : this._rightGroup).appendChild(button);
        }
    }

    override hide() {
        this._table?.domNode?.classList.remove('mu-table-tools-active');
        this._block = null;
        this._table = null;
        super.hide();
    }

    private _showForCell(block: CellBlock) {
        if (
            !this.muya.domNode.isConnected
            || this.muya.domNode.closest('[aria-hidden="true"]')
        ) {
            this.hide();
            return;
        }

        const table = block.table;
        const tableNode = table.domNode;
        if (!tableNode)
            return;
        const tableSurface
            = tableNode.querySelector<HTMLElement>(':scope > .mu-table-inner') ?? tableNode;

        if (this._table !== table)
            this._table?.domNode?.classList.remove('mu-table-tools-active');
        this._block = block;
        this._table = table;
        tableNode.classList.add('mu-table-tools-active');
        this.container!.style.width = `${Math.max(180, tableSurface.getBoundingClientRect().width)}px`;
        this._updateAlignment();
        this.show(tableSurface);
    }

    private _updateAlignment() {
        const align = this._block?.align ?? 'none';
        for (const action of ['align-left', 'align-center', 'align-right'] as const) {
            const active = align === action.slice('align-'.length);
            const button = this._buttons.get(action);
            button?.classList.toggle('active', active);
            button?.setAttribute('aria-pressed', String(active));
        }
    }

    private _runAction(event: MouseEvent, action: TableToolAction) {
        event.preventDefault();
        event.stopPropagation();
        const block = this._block;
        const table = this._table;
        if (!block?.parent || !table?.parent)
            return;

        const column = block.columnOffset;
        switch (action) {
            case 'resize': {
                const button = this._buttons.get(action)!;
                this.muya.eventCenter.emit(
                    'muya-table-picker',
                    { row: table.rowCount - 1, column: table.columnCount - 1 },
                    button,
                    (row: number, columnCount: number) => {
                        if (!table.parent)
                            return;
                        this.hide();
                        table.resize(row + 1, columnCount + 1)?.setCursor(0, 0, true);
                    },
                );
                break;
            }
            case 'align-left':
            case 'align-center':
            case 'align-right':
                table.alignColumn(column, action.slice('align-'.length));
                this._updateAlignment();
                break;
            case 'more': {
                const button = this._buttons.get(action)!;
                const rect = button.getBoundingClientRect();
                block.domNode?.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.right,
                    clientY: rect.bottom + 4,
                }));
                break;
            }
            case 'remove': {
                this.hide();
                table.removeTable()?.setCursor(0, 0, true);
                break;
            }
        }
    }
}
