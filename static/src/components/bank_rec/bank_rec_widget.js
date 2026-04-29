/** @odoo-module **/
import { Component, useState, onMounted } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { WithSearch } from "@web/search/with_search/with_search";
import { SearchModel } from "@web/search/search_model";
import { BankRecTransactionList } from "./bank_rec_transaction_list";
import { BankRecForm } from "./bank_rec_form";

/**
 * Subclass SearchModel so that each dynamicFilter item becomes its own group.
 * Default behaviour puts all items in one group (OR-ed, one chip).
 * We want separate groups (AND-ed, separate chips).
 */
class BankRecSearchModel extends SearchModel {
    _createGroupOfDynamicFilters(dynamicFilters) {
        for (const filter of dynamicFilters) {
            super._createGroupOfDynamicFilters([filter]);
        }
    }
}

export class BankRecWidget extends Component {
    static template = "odooer_account.BankRecWidget";
    static components = { WithSearch, BankRecTransactionList, BankRecForm };
    BankRecSearchModel = BankRecSearchModel;

    setup() {
        const ctx = this.props.action.context || {};
        this.state = useState({
            journalId: ctx.journal_id || null,
            stLineFilter: ctx.active_st_line_id || null,
            status: ctx.active_st_line_id ? 'all' : 'unreconciled',
            selectedLineId: null,
            recData: null,
            loading: false,
            listVersion: 0,
        });

        if (ctx.active_st_line_id) {
            onMounted(() => this.selectLine(ctx.active_st_line_id));
        }
    }

    /** Status-only domain. Journal is injected via dynamicFilters so it shows as a removable facet. */
    get baseDomain() {
        if (this.state.status === 'unreconciled') return [['is_reconciled', '=', false]];
        if (this.state.status === 'reconciled')   return [['is_reconciled', '=', true]];
        return [];
    }

    /** Journal filter passed as a SearchModel dynamic filter (shows as removable facet in SearchBar). */
    get dynamicFilters() {
        const ctx = this.props.action.context || {};
        const filters = [];
        if (this.state.journalId) {
            const label = ctx.journal_name || `Journal #${this.state.journalId}`;
            filters.push({ description: label, domain: [['journal_id', '=', this.state.journalId]] });
        }
        if (this.state.stLineFilter) {
            const label = ctx.active_move_name || `Statement #${this.state.stLineFilter}`;
            filters.push({ description: label, domain: [['id', '=', this.state.stLineFilter]] });
        }
        return filters;
    }

    setStatus(status) {
        this.state.status = status;
    }

    async selectLine(lineId) {
        this.state.selectedLineId = lineId;
        this.state.loading = true;
        this.state.recData = null;
        try {
            this.state.recData = await rpc('/odooer/bank_rec/get_rec_data', { st_line_id: lineId });
        } finally {
            this.state.loading = false;
        }
    }

    async onReloadData(updatedRecData) {
        if (updatedRecData) {
            this.state.recData = updatedRecData;
        } else if (this.state.selectedLineId) {
            await this.selectLine(this.state.selectedLineId);
        }
        this.state.listVersion++;
    }

    onLineReconciled() {
        this.state.recData = null;
        this.state.selectedLineId = null;
        this.state.listVersion++;
    }
}

registry.category("actions").add("odooer_bank_rec_widget", BankRecWidget);
