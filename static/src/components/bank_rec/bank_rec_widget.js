/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { BankRecTransactionList } from "./bank_rec_transaction_list";
import { BankRecForm } from "./bank_rec_form";

export class BankRecWidget extends Component {
    static template = "odooer_account.BankRecWidget";
    static components = { BankRecTransactionList, BankRecForm };

    setup() {
        // journal_id is set when opened from the dashboard button;
        // active_id is set by the router when navigating directly via URL (e.g. /odoo/accounting/6/odooer_bank_rec_widget)
        this.journalId = this.props.action.context.journal_id || this.props.action.context.active_id;
        this.state = useState({
            selectedLineId: null,
            recData: null,
            loading: false,
            listVersion: 0,  // increment to trigger left-panel reload
        });
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

    /** Called by BankRecForm when it needs fresh data (e.g. after partner change or unmatch).
     *  Accepts an optional already-fetched recData to avoid a redundant server round-trip. */
    async onReloadData(updatedRecData) {
        if (updatedRecData) {
            this.state.recData = updatedRecData;
        } else if (this.state.selectedLineId) {
            await this.selectLine(this.state.selectedLineId);
        }
        // Refresh left panel so reconciled status reflects the change
        this.state.listVersion++;
    }

    onLineReconciled() {
        this.state.recData = null;
        this.state.selectedLineId = null;
        this.state.listVersion++;  // refresh left panel
    }
}

registry.category("actions").add("odooer_bank_rec_widget", BankRecWidget);
