/** @odoo-module **/
import { Component, useState } from "@odoo/owl";

// Date presets available in the filter dropdown.
// Value 'custom' means "use raw date inputs".
const DATE_PRESETS = [
    { value: 'this_year',   label: 'This Year' },
    { value: 'last_year',   label: 'Last Year' },
    { value: 'this_quarter', label: 'This Quarter' },
    { value: 'this_month',  label: 'This Month' },
    { value: 'last_month',  label: 'Last Month' },
    { value: 'custom',      label: 'Custom' },
];

function buildYearMonthPresets() {
    const today = new Date();
    const presets = [];
    // Last 3 full years
    for (let i = 0; i < 3; i++) {
        const y = today.getFullYear() - i;
        presets.push({ value: String(y), label: String(y) });
    }
    // Last 12 months
    for (let i = 0; i < 12; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
        presets.push({ value: `${year}-${month}`, label });
    }
    return presets;
}

const EXTRA_PRESETS = buildYearMonthPresets();

export class Filters extends Component {
    static template = "odooer_account.Filters";

    setup() {
        this.state = useState({
            showComparison: this.props.options?.comparison?.enabled || false,
        });
        this.allPresets = [...DATE_PRESETS, ...EXTRA_PRESETS];
    }

    get isSingleDate() { return this.props.options?.date?.mode === 'single'; }
    get dateFrom() { return this.props.options?.date?.date_from || ""; }
    get dateTo()   { return this.props.options?.date?.date_to   || ""; }
    get showDraft() { return this.props.options?.show_draft !== false; }
    get hide0()    { return this.props.options?.hide_0_lines || false; }

    get currentFilter() {
        return this.props.options?.date?.filter || 'custom';
    }

    get currentFilterLabel() {
        const preset = this.allPresets.find(p => p.value === this.currentFilter);
        return preset ? preset.label : 'Custom';
    }

    get isCustomFilter() {
        return this.currentFilter === 'custom';
    }

    onPresetChange(ev) {
        const filter = ev.target.value;
        if (filter === 'custom') {
            // Keep current dates, just mark as custom
            this._emit({ date: { ...this.props.options.date, filter: 'custom' } });
        } else {
            // Let backend resolve dates; keep existing dates as fallback
            this._emit({ date: { ...this.props.options.date, filter } });
        }
    }

    onDateFromChange(ev) {
        this._emit({ date: { ...this.props.options.date, filter: 'custom', date_from: ev.target.value } });
    }

    onDateToChange(ev) {
        this._emit({ date: { ...this.props.options.date, filter: 'custom', date_to: ev.target.value } });
    }

    onToggleDraft(ev) {
        this._emit({ show_draft: ev.target.checked });
    }

    onToggleHide0(ev) {
        this._emit({ hide_0_lines: ev.target.checked });
    }

    onToggleComparison(ev) {
        const enabled = ev.target.checked;
        this.state.showComparison = enabled;
        this._emit({ comparison: { ...this.props.options.comparison, enabled } });
    }

    onComparisonPeriods(ev) {
        const n = parseInt(ev.target.value) || 1;
        this._emit({ comparison: { ...this.props.options.comparison, number_period: n } });
    }

    _emit(patch) {
        this.props.onOptionsChanged(patch);
    }
}
