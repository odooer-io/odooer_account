/** @odoo-module **/
import { Component, useState } from "@odoo/owl";

export class Filters extends Component {
    static template = "odooer_account.Filters";

    setup() {
        this.state = useState({
            showComparison: this.props.options?.comparison?.enabled || false,
        });
    }

    get isSingleDate() { return this.props.options?.date?.mode === 'single'; }
    get dateFrom() { return this.props.options?.date?.date_from || ""; }
    get dateTo()   { return this.props.options?.date?.date_to   || ""; }
    get showDraft() { return this.props.options?.show_draft !== false; }
    get hide0()    { return this.props.options?.hide_0_lines || false; }

    onDateFromChange(ev) {
        this._emit({ date: { ...this.props.options.date, date_from: ev.target.value } });
    }

    onDateToChange(ev) {
        this._emit({ date: { ...this.props.options.date, date_to: ev.target.value } });
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
