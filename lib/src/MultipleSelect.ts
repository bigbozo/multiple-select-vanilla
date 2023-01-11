/**
 * @author zhixin wen <wenzhixin2010@gmail.com>
 */
import Constants from './constants';
import { compareObjects, deepCopy, findByParam, removeDiacritics, removeUndefined, setDataKeys } from './utils';
import { createDomElement, findParent, getElementOffset, getElementSize, insertAfter, toggleElement } from './utils/domUtils';
import { BindingEventService, VirtualScroll } from './services';
import { MultipleSelectOption } from './interfaces/multipleSelectOption.interface';
import { OptGroupRowData, OptionRowData } from './interfaces';

export class MultipleSelect {
  protected _bindEventService: BindingEventService;
  protected allSelected = false;
  protected fromHtml = false;
  protected choiceElm!: HTMLButtonElement;
  protected closeElm?: HTMLElement | null;
  protected filterText = '';
  protected updateData: any[] = [];
  protected data: OptionRowData[] = [];
  protected dataTotal?: any;
  protected dropElm!: HTMLDivElement;
  protected ulElm?: HTMLUListElement | null;
  protected parentElm!: HTMLDivElement;
  protected labelElm?: HTMLLabelElement | null;
  protected selectAllElm?: HTMLInputElement | null;
  protected searchInputElm?: HTMLInputElement | null;
  protected selectGroupElms?: NodeListOf<HTMLInputElement>;
  protected selectItemElms?: NodeListOf<HTMLInputElement>;
  protected disableItemElms?: NodeListOf<HTMLInputElement>;
  protected noResultsElm?: HTMLDivElement | null;
  protected options: MultipleSelectOption;
  protected selectAllName = '';
  protected selectGroupName = '';
  protected selectItemName = '';
  protected tabIndex?: string | null;
  protected updateDataStart?: number;
  protected updateDataEnd?: number;
  protected virtualScroll?: VirtualScroll | null;

  constructor(protected elm: HTMLSelectElement, options?: Partial<MultipleSelectOption>) {
    this.options = Object.assign({}, Constants.DEFAULTS, this.elm.dataset, options);
    this._bindEventService = new BindingEventService({ distinctEvent: true });
  }

  async init() {
    await this.initLocale();
    this.initContainer();
    this.initData();
    this.initSelected(true);
    this.initFilter();
    this.initDrop();
    this.initView();
    this.options.onAfterCreate();
  }

  /**
   * destroy the element, if the hard destroy is also enabled then we'll also nullify it on the multipleSelect instance array.
   * When a soft destroy is called, we'll only remove it from the DOM but we'll keep all multipleSelect instances
   */
  destroy(hardDestroy = true) {
    if (this.parentElm) {
      this.options.onDestroy({ hardDestroy });
      this.elm.before(this.parentElm);
      this.elm.classList.remove('ms-offscreen');
      this._bindEventService.unbindAll();

      if (this.tabIndex) {
        this.elm.tabIndex = +this.tabIndex;
      }

      this.virtualScroll?.destroy();
      this.parentElm.parentNode?.removeChild(this.parentElm);

      if (this.fromHtml) {
        delete this.options.data;
        this.fromHtml = false;
      }
      this.options.onAfterDestroy({ hardDestroy });

      if (hardDestroy) {
        this.options.onHardDestroyed();
        Object.keys(this.options).forEach((o) => delete (this as any)[o]);
      }
    }
  }

  protected async initLocale() {
    if (this.options.locale) {
      const importedLocale = await import(`./locales/multiple-select-${this.options.locale}.js`);
      const locales = importedLocale?.default ?? importedLocale;
      const parts = this.options.locale.split(/-|_/);

      parts[0] = parts[0].toLowerCase();
      if (parts[1]) {
        parts[1] = parts[1].toUpperCase();
      }

      if (locales[this.options.locale]) {
        Object.assign(this.options, locales[this.options.locale]);
      } else if (locales[parts.join('-')]) {
        Object.assign(this.options, locales[parts.join('-')]);
      } else if (locales[parts[0]]) {
        Object.assign(this.options, locales[parts[0]]);
      }
    }
  }

  protected initContainer() {
    const name = this.elm.getAttribute('name') || this.options.name || '';

    // hide select element
    this.elm.style.display = 'none';

    // label element
    this.labelElm = this.elm.closest('label');
    if (!this.labelElm && this.elm.id) {
      this.labelElm = document.createElement('label');
      this.labelElm.htmlFor = this.elm.id;
    }
    if (this.labelElm?.querySelector('input')) {
      this.labelElm = null;
    }

    // single or multiple
    if (typeof this.options.single === 'undefined') {
      this.options.single = !this.elm.multiple;
    }

    // restore class and title from select element
    this.parentElm = createDomElement('div', {
      className: `ms-parent ${this.elm.className || ''}`,
      title: this.elm.getAttribute('title') || '',
    });

    // add placeholder to choice button
    this.options.placeholder = this.options.placeholder || this.elm.getAttribute('placeholder') || '';

    this.tabIndex = this.elm.getAttribute('tabindex');
    let tabIndex = '';
    if (this.tabIndex !== null) {
      this.elm.tabIndex = -1;
      tabIndex = this.tabIndex && `tabindex="${this.tabIndex}"`;
    }

    this.choiceElm = createDomElement('button', {
      type: 'button',
      className: `ms-choice`,
    });

    if (isNaN(tabIndex as any)) {
      this.choiceElm.tabIndex = +tabIndex;
    }

    this.choiceElm.appendChild(
      createDomElement('span', {
        className: 'ms-placeholder',
        textContent: this.options.placeholder,
      })
    );

    if (this.options.showClear) {
      this.choiceElm.appendChild(
        createDomElement('div', {
          className: 'icon-close',
        })
      );
    }

    this.choiceElm.appendChild(
      createDomElement('div', {
        className: 'icon-caret',
      })
    );

    // default position is bottom
    this.dropElm = createDomElement('div', {
      className: `ms-drop ${this.options.position}`,
    });

    this.closeElm = this.choiceElm.querySelector('.icon-close');

    if (this.options.dropWidth) {
      this.dropElm.style.width = `${this.options.dropWidth}px`;
    }

    insertAfter(this.elm, this.parentElm);

    this.parentElm.appendChild(this.choiceElm);
    this.parentElm.appendChild(this.dropElm);

    if (this.elm.disabled) {
      this.choiceElm.classList.add('disabled');
    }

    this.selectAllName = `data-name="selectAll${name}"`;
    this.selectGroupName = `data-name="selectGroup${name}"`;
    this.selectItemName = `data-name="selectItem${name}"`;

    if (!this.options.keepOpen) {
      this._bindEventService.unbind(document.body, 'click');
      this._bindEventService.bind(document.body, 'click', ((e: MouseEvent & { target: HTMLElement }) => {
        if (e.target === this.choiceElm || findParent(e.target, '.ms-choice') === this.choiceElm) {
          return;
        }

        if (
          (e.target === this.dropElm || (findParent(e.target, '.ms-drop') !== this.dropElm && e.target !== this.elm)) &&
          this.options.isOpen
        ) {
          this.close();
        }
      }) as EventListener);
    }
  }

  protected initData() {
    const data: any[] = [];

    if (this.options.data) {
      if (Array.isArray(this.options.data)) {
        this.data = this.options.data.map((it: any) => {
          if (typeof it === 'string' || typeof it === 'number') {
            return {
              text: it,
              value: it,
            };
          }
          return it;
        });
      } else if (typeof this.options.data === 'object') {
        for (const [value, text] of Object.entries(this.options.data)) {
          data.push({
            value,
            text,
          });
        }
        this.data = data;
      }
    } else {
      this.elm.childNodes.forEach((elm) => {
        const row = this.initRow(elm as HTMLOptionElement);
        if (row) {
          data.push(this.initRow(elm as HTMLOptionElement));
        }
      });

      this.options.data = data;
      this.data = data;
      this.fromHtml = true;
    }

    this.dataTotal = setDataKeys(this.data);
  }

  protected initRow(elm: HTMLOptionElement, groupDisabled?: boolean) {
    const row: any = {};
    if (elm.tagName?.toLowerCase() === 'option') {
      row.type = 'option';
      row.text = this.options.textTemplate(elm);
      row.value = elm.value;
      row.visible = true;
      row.selected = !!elm.selected;
      row.disabled = groupDisabled || elm.disabled;
      row.classes = elm.getAttribute('class') || '';
      row.title = elm.getAttribute('title') || '';

      if (elm.dataset.value) {
        row._value = elm.dataset.value; // value for object
      }
      if (Object.keys(elm.dataset).length) {
        row._data = elm.dataset;

        if (row._data.divider) {
          row.divider = row._data.divider;
        }
      }

      return row;
    }

    if (elm.tagName?.toLowerCase() === 'optgroup') {
      row.type = 'optgroup';
      row.label = this.options.labelTemplate(elm);
      row.visible = true;
      row.selected = !!elm.selected;
      row.disabled = elm.disabled;
      (row as OptGroupRowData).children = [];
      if (Object.keys(elm.dataset).length) {
        row._data = elm.dataset;
      }

      elm.childNodes.forEach((childNode) => {
        (row as OptGroupRowData).children.push(this.initRow(childNode as HTMLOptionElement, row.disabled));
      });

      return row;
    }

    return null;
  }

  protected initDrop() {
    this.initList();
    this.update(true);

    if (this.options.isOpen) {
      setTimeout(() => this.open(), 50);
    }

    if (this.options.openOnHover && this.parentElm) {
      this._bindEventService.bind(this.parentElm, 'mouseover', () => this.open());
      this._bindEventService.bind(this.parentElm, 'mouseout', () => this.close());
    }
  }

  protected initFilter() {
    this.filterText = '';

    if (this.options.filter || !this.options.filterByDataLength) {
      return;
    }

    let length = 0;
    for (const option of this.data) {
      if (option.type === 'optgroup') {
        length += (option as OptGroupRowData).children.length;
      } else {
        length += 1;
      }
    }
    this.options.filter = length > this.options.filterByDataLength;
  }

  protected initList() {
    const html = [];

    if (this.options.filter) {
      html.push(`
        <div class="ms-search">
          <input type="text" autocomplete="off" autocorrect="off"
            autocapitalize="off" spellcheck="false"
            placeholder="${this.options.filterPlaceholder || '🔎︎'}">
        </div>
      `);
    }

    html.push('<ul></ul>');

    this.dropElm.innerHTML = html.join('');
    this.ulElm = this.dropElm.querySelector<HTMLUListElement>('ul');

    this.initListItems();
  }

  protected initListItems() {
    const rows = this.getListRows();
    let offset = 0;

    if (this.options.selectAll && !this.options.single) {
      offset = -1;
    }

    if (rows.length > Constants.BLOCK_ROWS * Constants.CLUSTER_BLOCKS) {
      if (this.virtualScroll) {
        this.virtualScroll.destroy();
      }

      const dropVisible = this.dropElm.style.display !== 'none';
      if (!dropVisible) {
        this.dropElm.style.left = '-10000';
        this.dropElm.style.display = 'block';
      }

      const updateDataOffset = () => {
        this.updateDataStart = this.virtualScroll!.dataStart + offset;
        this.updateDataEnd = this.virtualScroll!.dataEnd + offset;
        if (this.updateDataStart < 0) {
          this.updateDataStart = 0;
        }
        if (this.updateDataEnd > this.data.length) {
          this.updateDataEnd = this.data.length;
        }
      };

      if (this.ulElm) {
        this.virtualScroll = new VirtualScroll({
          rows,
          scrollEl: this.ulElm,
          contentEl: this.ulElm,
          callback: () => {
            updateDataOffset();
            this.events();
          },
        });
      }

      updateDataOffset();

      if (!dropVisible) {
        this.dropElm.style.left = '0';
        this.dropElm.style.display = 'none';
      }
    } else {
      if (this.ulElm) {
        this.ulElm.innerHTML = rows.join('');
        this.updateDataStart = 0;
        this.updateDataEnd = this.updateData.length;
        this.virtualScroll = null;
      }
    }
    this.events();
  }

  protected getListRows() {
    const rows = [];

    if (this.options.selectAll && !this.options.single) {
      rows.push(`
        <li class="ms-select-all">
        <label>
        <input type="checkbox" ${this.selectAllName}${this.allSelected ? ' checked="checked"' : ''} />
        <span>${this.options.formatSelectAll()}</span>
        </label>
        </li>
      `);
    }

    this.updateData = [];
    this.data.forEach((row) => {
      rows.push(...this.initListItem(row));
    });

    rows.push(`<li class="ms-no-results">${this.options.formatNoMatchesFound()}</li>`);

    return rows;
  }

  protected initListItem(row: any, level = 0) {
    const title = row?.title ? `title="${row.title}"` : '';
    const multiple = this.options.multiple ? 'multiple' : '';
    const type = this.options.single ? 'radio' : 'checkbox';
    let classes = '';

    if (!row?.visible) {
      return [];
    }

    this.updateData.push(row);

    if (this.options.single && !this.options.singleRadio) {
      classes = 'hide-radio ';
    }

    if (row.selected) {
      classes += 'selected ';
    }

    if (row.type === 'optgroup') {
      const customStyle = this.options.styler(row);
      const style = customStyle ? `style="${customStyle}"` : '';
      const html = [];
      const group =
        this.options.hideOptgroupCheckboxes || this.options.single
          ? `<span ${this.selectGroupName} data-key="${row._key}"></span>`
          : `<input type="checkbox"
          ${this.selectGroupName}
          data-key="${row._key}"
          ${row.selected ? ' checked="checked"' : ''}
          ${row.disabled ? ' disabled="disabled"' : ''}
        >`;

      if (!classes.includes('hide-radio') && (this.options.hideOptgroupCheckboxes || this.options.single)) {
        classes += 'hide-radio ';
      }

      html.push(`
        <li class="group ${classes}" ${style}>
        <label class="optgroup${this.options.single || row.disabled ? ' disabled' : ''}">
        ${group}${row.label}
        </label>
        </li>
      `);

      (row as OptGroupRowData).children.forEach((child: any) => {
        html.push(...this.initListItem(child, 1));
      });

      return html;
    }

    const customStyle = this.options.styler(row);
    const style = customStyle ? `style="${customStyle}"` : '';
    classes += row.classes || '';

    if (level && this.options.single) {
      classes += `option-level-${level} `;
    }

    if (row.divider) {
      return '<li class="option-divider"/>';
    }

    return [
      `
      <li class="${multiple} ${classes}" ${title} ${style}>
      <label class="${row.disabled ? 'disabled' : ''}">
      <input type="${type}"
        value="${row.value}"
        data-key="${row._key}"
        ${this.selectItemName}
        ${row.selected ? ' checked="checked"' : ''}
        ${row.disabled ? ' disabled="disabled"' : ''}
      >
      <span>${row.text}</span>
      </label>
      </li>
    `,
    ];
  }

  protected initSelected(ignoreTrigger = false) {
    let selectedTotal = 0;

    for (const row of this.data) {
      if (row.type === 'optgroup') {
        const selectedCount = (row as OptGroupRowData).children.filter((child) => {
          return child && child.selected && !child.disabled && child.visible;
        }).length;

        if ((row as OptGroupRowData).children.length) {
          row.selected =
            !this.options.single &&
            selectedCount &&
            selectedCount ===
              (row as OptGroupRowData).children.filter(
                (child: any) => child && !child.disabled && child.visible && !child.divider
              ).length;
        }
        selectedTotal += selectedCount;
      } else {
        selectedTotal += row.selected && !row.disabled && row.visible ? 1 : 0;
      }
    }

    this.allSelected =
      this.data.filter((row: OptionRowData) => {
        return row.selected && !row.disabled && row.visible;
      }).length === this.data.filter((row) => !row.disabled && row.visible && !row.divider).length;

    if (!ignoreTrigger) {
      if (this.allSelected) {
        this.options.onCheckAll();
      } else if (selectedTotal === 0) {
        this.options.onUncheckAll();
      }
    }
  }

  protected initView() {
    let computedWidth;

    if (window.getComputedStyle) {
      computedWidth = window.getComputedStyle(this.elm).width;

      if (computedWidth === 'auto') {
        computedWidth = getElementSize(this.dropElm, 'outer', 'width') + 20;
      }
    } else {
      computedWidth = getElementSize(this.elm, 'outer', 'width') + 20;
    }

    this.parentElm.style.width = `${this.options.width || computedWidth}px`;
    this.elm.style.display = 'block';
    this.elm.classList.add('ms-offscreen');
  }

  protected events() {
    this._bindEventService.unbind(this.searchInputElm);
    this._bindEventService.unbind(this.selectAllElm);
    this._bindEventService.unbind(this.selectGroupElms);
    this._bindEventService.unbind(this.selectItemElms);
    this._bindEventService.unbind(this.disableItemElms);
    this._bindEventService.unbind(this.noResultsElm);

    this.searchInputElm = this.dropElm.querySelector<HTMLInputElement>('.ms-search input');
    this.selectAllElm = this.dropElm.querySelector<HTMLInputElement>(`input[${this.selectAllName}]`);
    this.selectGroupElms = this.dropElm.querySelectorAll<HTMLInputElement>(
      `input[${this.selectGroupName}],span[${this.selectGroupName}]`
    );
    this.selectItemElms = this.dropElm.querySelectorAll<HTMLInputElement>(`input[${this.selectItemName}]:enabled`);
    this.disableItemElms = this.dropElm.querySelectorAll<HTMLInputElement>(`input[${this.selectItemName}]:disabled`);
    this.noResultsElm = this.dropElm.querySelector<HTMLDivElement>('.ms-no-results');

    const toggleOpen = (e: MouseEvent & { target: HTMLElement }) => {
      e.preventDefault();
      if (e.target.classList.contains('icon-close')) {
        return;
      }
      this[this.options.isOpen ? 'close' : 'open']();
    };

    if (this.labelElm) {
      this._bindEventService.bind(this.labelElm, 'click', ((e: MouseEvent & { target: HTMLElement }) => {
        if (e.target.nodeName.toLowerCase() !== 'label') {
          return;
        }
        toggleOpen(e);
        if (!this.options.filter || !this.options.isOpen) {
          this.focus();
        }
        e.stopPropagation(); // Causes lost focus otherwise
      }) as EventListener);
    }

    this._bindEventService.bind(this.choiceElm, 'click', toggleOpen as EventListener);
    if (this.options.onFocus) {
      this._bindEventService.bind(this.choiceElm, 'focus', this.options.onFocus as EventListener);
    }
    if (this.options.onBlur) {
      this._bindEventService.bind(this.choiceElm, 'blur', this.options.onBlur as EventListener);
    }

    this._bindEventService.bind(this.parentElm, 'keydown', ((e: KeyboardEvent) => {
      // esc key
      if (e.code === 'Escape' && !this.options.keepOpen) {
        this.close();
        this.choiceElm.focus();
      }
    }) as EventListener);

    if (this.closeElm) {
      this._bindEventService.bind(this.closeElm, 'click', ((e: MouseEvent) => {
        e.preventDefault();
        this._checkAll(false, true);
        this.initSelected(false);
        this.updateSelected();
        this.update();
        this.options.onClear();
      }) as EventListener);
    }

    if (this.searchInputElm) {
      this._bindEventService.bind(this.searchInputElm, 'keydown', ((e: KeyboardEvent) => {
        // Ensure shift-tab causes lost focus from filter as with clicking away
        if (e.code === 'Tab' && e.shiftKey) {
          this.close();
        }
      }) as EventListener);

      this._bindEventService.bind(this.searchInputElm, 'keyup', ((e: KeyboardEvent) => {
        // enter or space
        // Avoid selecting/deselecting if no choices made
        if (this.options.filterAcceptOnEnter && ['Enter', 'Space'].includes(e.code) && this.searchInputElm?.value) {
          if (this.options.single) {
            const visibleLiElms: HTMLInputElement[] = [];
            this.selectItemElms?.forEach((selectedElm) => {
              if (selectedElm.closest('li')?.style.display !== 'none') {
                visibleLiElms.push(selectedElm);
              }
            });
            if (visibleLiElms.length) {
              const [selectItemAttrName] = this.selectItemName.split('='); // [data-name="selectItem"], we want "data-name" attribute
              if (visibleLiElms[0].hasAttribute(selectItemAttrName)) {
                this.setSelects([visibleLiElms[0].value]);
              }
            }
          } else {
            this.selectAllElm?.click();
          }
          this.close();
          this.focus();
          return;
        }
        this.filter();
      }) as EventListener);
    }

    if (this.selectAllElm) {
      this._bindEventService.unbind(this.selectAllElm, 'click');
      this._bindEventService.bind(this.selectAllElm, 'click', ((e: MouseEvent & { currentTarget: HTMLInputElement }) => {
        this._checkAll(e.currentTarget?.checked);
      }) as EventListener);
    }

    this._bindEventService.bind(this.selectGroupElms, 'click', ((e: MouseEvent & { currentTarget: HTMLInputElement }) => {
      const selectElm = e.currentTarget;
      const checked = selectElm.checked;
      const group = findByParam(this.data, '_key', selectElm.dataset.key);

      this._checkGroup(group, checked);
      this.options.onOptgroupClick(
        removeUndefined({
          label: group.label,
          selected: group.selected,
          data: group._data,
          children: group.children.map((child: any) => {
            if (child) {
              return removeUndefined({
                text: child.text,
                value: child.value,
                selected: child.selected,
                disabled: child.disabled,
                data: child._data,
              });
            }
          }),
        })
      );
    }) as EventListener);

    this._bindEventService.bind(this.selectItemElms, 'click', ((e: MouseEvent & { currentTarget: HTMLInputElement }) => {
      const selectElm = e.currentTarget;
      const checked = selectElm.checked;
      const option = findByParam(this.data, '_key', selectElm.dataset.key);

      this._check(option, checked);
      this.options.onClick(
        removeUndefined({
          text: option.text,
          value: option.value,
          selected: option.selected,
          data: option._data,
        })
      );

      if (this.options.single && this.options.isOpen && !this.options.keepOpen) {
        this.close();
      }
    }) as EventListener);
  }

  open() {
    if (this.choiceElm?.classList.contains('disabled')) {
      return;
    }
    // this.options.isOpen = true;
    setTimeout(() => (this.options.isOpen = true)); // TODO: original code doesn't need setTimeout
    this.parentElm.classList.add('ms-parent-open');
    this.choiceElm?.querySelector('div')?.classList.add('open');
    this.dropElm.style.display = 'block';

    if (this.selectAllElm?.parentElement) {
      this.selectAllElm.parentElement.style.display = 'block';
    }

    if (this.noResultsElm) {
      this.noResultsElm.style.display = 'none';
    }

    if (!this.data.length) {
      if (this.selectAllElm?.parentElement) {
        this.selectAllElm.parentElement.style.display = 'none';
      }
      if (this.noResultsElm) {
        this.noResultsElm.style.display = 'block';
      }
    }

    if (this.options.container) {
      const offset = getElementOffset(this.dropElm);
      let container: HTMLElement;
      if (this.options.container instanceof Node) {
        container = this.options.container as HTMLElement;
      } else if (typeof this.options.container === 'string') {
        // prettier-ignore
        container = this.options.container === 'body' ? document.body : (document.querySelector(this.options.container) as HTMLElement);
      }
      container!.appendChild(this.dropElm);
      this.dropElm.style.top = `${offset?.top ?? 0}px`;
      this.dropElm.style.left = `${offset?.left ?? 0}px`;
      this.dropElm.style.minWidth = 'auto';
      this.dropElm.style.width = `${getElementSize(this.parentElm, 'outer', 'width')}px`;
    }

    let maxHeight = this.options.maxHeight;
    if (this.options.maxHeightUnit === 'row') {
      const liElm = this.dropElm.querySelector<HTMLLIElement>('ul>li');
      maxHeight = getElementSize(liElm!, 'outer', 'height') * this.options.maxHeight;
    }
    const ulElm = this.dropElm.querySelector('ul');
    if (ulElm) {
      ulElm.style.maxHeight = `${maxHeight}px`;
    }
    const multElms = this.dropElm.querySelectorAll<HTMLDivElement>('.multiple');
    multElms.forEach((multElm) => (multElm.style.width = `${this.options.multipleWidth}px`));

    if (this.data.length && this.options.filter) {
      if (this.searchInputElm) {
        this.searchInputElm.value = '';
        this.searchInputElm.focus();
      }
      this.filter(true);
    }
    this.options.onOpen();
  }

  close() {
    this.options.isOpen = false;
    this.parentElm.classList.remove('ms-parent-open');
    this.choiceElm?.querySelector('div')?.classList.remove('open');
    this.dropElm.style.display = 'none';

    if (this.options.container) {
      this.parentElm.appendChild(this.dropElm);
      this.dropElm.style.top = 'auto';
      this.dropElm.style.left = 'auto';
    }
    this.options.onClose();
  }

  protected update(ignoreTrigger = false) {
    const valueSelects = this.getSelects();
    let textSelects = this.getSelects('text');

    if (this.options.displayValues) {
      textSelects = valueSelects;
    }

    const spanElm = this.choiceElm?.querySelector('span') as HTMLSpanElement;
    const sl = valueSelects.length;
    let html = '';

    if (sl === 0) {
      spanElm.classList.add('ms-placeholder');
      spanElm.innerHTML = this.options.placeholder || '';
    } else if (sl < this.options.minimumCountSelected) {
      html = textSelects.join(this.options.displayDelimiter);
    } else if (this.options.formatAllSelected() && sl === this.dataTotal) {
      html = this.options.formatAllSelected();
    } else if (this.options.ellipsis && sl > this.options.minimumCountSelected) {
      html = `${textSelects.slice(0, this.options.minimumCountSelected).join(this.options.displayDelimiter)}...`;
    } else if (this.options.formatCountSelected(sl, this.dataTotal) && sl > this.options.minimumCountSelected) {
      html = this.options.formatCountSelected(sl, this.dataTotal);
    } else {
      html = textSelects.join(this.options.displayDelimiter);
    }

    if (html) {
      spanElm?.classList.remove('ms-placeholder');
      spanElm.innerHTML = html;
    }

    if (this.options.displayTitle) {
      spanElm.title = this.getSelects('text').join('');
    }

    // set selects to select
    const selectedValues = this.getSelects().join('');
    if (this.options.single) {
      this.elm.value = selectedValues;
    } else {
      // when multiple values could be set, so we need to loop through each
      const selectOptions = this.elm.options;
      for (let i = 0, ln = selectOptions.length; i < ln; i++) {
        const isSelected = selectedValues.indexOf(selectOptions[i].value) >= 0;
        selectOptions[i].selected = isSelected;
      }
    }

    // trigger <select> change event
    if (!ignoreTrigger) {
      this.elm.dispatchEvent(new Event('change'));
    }
  }

  protected updateSelected() {
    for (let i = this.updateDataStart!; i < this.updateDataEnd!; i++) {
      const row = this.updateData[i];
      const inputElm = this.dropElm.querySelector<HTMLInputElement>(`input[data-key=${row._key}]`);
      if (inputElm) {
        inputElm.checked = row.selected;
        const closestLiElm = inputElm.closest('li');
        if (closestLiElm) {
          if (row.selected && !closestLiElm.classList.contains('selected')) {
            closestLiElm.classList.add('selected');
          } else if (!row.selected) {
            closestLiElm.classList.remove('selected');
          }
        }
      }
    }

    const noResult = this.data.filter((row) => row.visible).length === 0;

    if (this.selectAllElm) {
      this.selectAllElm.checked = this.allSelected;
      toggleElement(this.selectAllElm.closest('li'), !noResult);
    }

    toggleElement(this.noResultsElm, noResult);

    if (this.virtualScroll) {
      this.virtualScroll.rows = this.getListRows();
    }
  }

  /**
   * Get current options, by default we'll return an immutable deep copy of the options to avoid conflicting with the lib
   * but in rare occasion we might want to the return the actual, but mutable, options
   * @param {Boolean} [returnDeepCopy]
   */
  getOptions(returnDeepCopy = true) {
    // deep copy and remove data
    const options = Object.assign({}, this.options);
    delete options.data;

    return returnDeepCopy ? deepCopy(options) : this.options;
  }

  refreshOptions(options: Partial<MultipleSelectOption>) {
    // If the objects are equivalent then avoid the call of destroy / init methods
    if (compareObjects(this.options, options, true)) {
      return;
    }
    this.options = Object.assign(this.options, options);
    this.destroy(false);
    this.init();
  }

  // value html, or text, default: 'value'
  getSelects(type = 'value') {
    const values = [];
    for (const row of this.data) {
      if (row.type === 'optgroup') {
        const selectedChildren = (row as OptGroupRowData).children.filter((child) => child?.selected);
        if (!selectedChildren.length) {
          continue;
        }

        if (type === 'value' || this.options.single) {
          values.push(
            ...selectedChildren.map((child: any) => {
              return type === 'value' ? child._value || child[type] : child[type];
            })
          );
        } else {
          const value = [];
          value.push('[');
          value.push(row.label);
          value.push(`: ${selectedChildren.map((child: any) => child[type]).join(', ')}`);
          value.push(']');
          values.push(value.join(''));
        }
      } else if (row.selected) {
        values.push(type === 'value' ? row._value || row[type] : (row as any)[type]);
      }
    }
    return values;
  }

  setSelects(values: any[], type = 'value', ignoreTrigger = false) {
    let hasChanged = false;
    const _setSelects = (rows: any[]) => {
      for (const row of rows) {
        let selected = false;
        if (type === 'text') {
          selected = values.includes(row.textContent.trim());
        } else {
          selected = values.includes(row._value || row.value);
          if (!selected && row.value === +row.value + '') {
            selected = values.includes(+row.value);
          }
        }
        if (row.selected !== selected) {
          hasChanged = true;
        }
        row.selected = selected;
      }
    };

    for (const row of this.data) {
      if (row.type === 'optgroup') {
        _setSelects((row as OptGroupRowData).children);
      } else {
        _setSelects([row]);
      }
    }

    if (hasChanged) {
      this.initSelected(ignoreTrigger);
      this.updateSelected();
      this.update(ignoreTrigger);
    }
  }

  enable() {
    this.choiceElm?.classList.remove('disabled');
  }

  disable() {
    this.choiceElm?.classList.add('disabled');
  }

  check(value: any) {
    const option = findByParam(this.data, 'value', value);
    if (!option) {
      return;
    }
    this._check(option, true);
  }

  uncheck(value: any) {
    const option = findByParam(this.data, 'value', value);
    if (!option) {
      return;
    }
    this._check(option, false);
  }

  protected _check(option: any, checked: boolean) {
    if (this.options.single) {
      this._checkAll(false, true);
    }
    option.selected = checked;
    this.initSelected();
    this.updateSelected();
    this.update();
  }

  checkAll() {
    this._checkAll(true);
  }

  uncheckAll() {
    this._checkAll(false);
  }

  protected _checkAll(checked: boolean, ignoreUpdate?: boolean) {
    for (const row of this.data) {
      if (row.type === 'optgroup') {
        this._checkGroup(row, checked, true);
      } else if (!row.disabled && !row.divider && (ignoreUpdate || row.visible)) {
        row.selected = checked;
      }
    }

    if (!ignoreUpdate) {
      this.initSelected();
      this.updateSelected();
      this.update();
    }
  }

  protected _checkGroup(group: any, checked: boolean, ignoreUpdate?: boolean) {
    group.selected = checked;
    group.children.forEach((row: any) => {
      if (row && !row.disabled && !row.divider && (ignoreUpdate || row.visible)) {
        row.selected = checked;
      }
    });

    if (!ignoreUpdate) {
      this.initSelected();
      this.updateSelected();
      this.update();
    }
  }

  checkInvert() {
    if (this.options.single) {
      return;
    }
    for (const row of this.data) {
      if (row.type === 'optgroup') {
        for (const child of (row as OptGroupRowData).children) {
          if (child) {
            if (!child.divider) {
              child.selected = !child.selected;
            }
          }
        }
      } else {
        if (row && !row.divider) {
          row.selected = !row.selected;
        }
      }
    }
    this.initSelected();
    this.updateSelected();
    this.update();
  }

  focus() {
    this.choiceElm?.focus();
    this.options.onFocus();
  }

  blur() {
    this.choiceElm?.blur();
    this.options.onBlur();
  }

  refresh() {
    this.destroy();
    this.init();
  }

  protected filter(ignoreTrigger?: boolean) {
    const originalText = this.searchInputElm?.value.trim() ?? '';
    const text = originalText.toLowerCase();

    if (this.filterText === text) {
      return;
    }
    this.filterText = text;

    for (const row of this.data) {
      if (row.type === 'optgroup') {
        if (this.options.filterGroup) {
          const rowLabel = `${row?.label ?? ''}`;
          if (row !== undefined && row !== null) {
            const visible = this.options.customFilter(
              removeDiacritics(rowLabel.toLowerCase()),
              removeDiacritics(text),
              rowLabel,
              originalText
            );

            row.visible = visible;
            for (const child of (row as OptGroupRowData).children) {
              if (child) {
                child.visible = visible;
              }
            }
          }
        } else {
          for (const child of (row as OptGroupRowData).children) {
            if (child !== undefined && child !== null) {
              const childText = `${child?.text ?? ''}`;
              child.visible = this.options.customFilter(
                removeDiacritics(childText.toLowerCase()),
                removeDiacritics(text),
                childText,
                originalText
              );
            }
          }
          row.visible = (row as OptGroupRowData).children.filter((child: any) => child?.visible).length > 0;
        }
      } else {
        const rowText = `${row?.text ?? ''}`;
        row.visible = this.options.customFilter(
          removeDiacritics(rowText.toLowerCase()),
          removeDiacritics(text),
          rowText,
          originalText
        );
      }
    }

    this.initListItems();
    this.initSelected(ignoreTrigger);
    this.updateSelected();

    if (!ignoreTrigger) {
      this.options.onFilter(text);
    }
  }
}
