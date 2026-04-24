/** @odoo-module **/
import { Component, useState, onWillStart, onWillUpdateProps } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";

export class BankRecTransactionList extends Component {
    static template = "odooer_account.BankRecTransactionList";
    static props = {
        journalId: Number,
        selectedLineId: { type: [Number, { value: null }], optional: true },
        onSelect: Function,
        onLineReconciled: Function,
        listVersion: { type: Number, optional: true },
    };

    setup() {
        this.dialog = useService("dialog");
        this.state = useState({
            lines: [],
            total: 0,
            loading: false,
            showReconciled: false,
            searchTerm: '',
            offset: 0,
        });
        onWillStart(() => this.loadLines());
        // Reload whenever the parent increments listVersion (after reconcile/unreconcile)
        onWillUpdateProps((nextProps) => {
            if (nextProps.listVersion !== this.props.listVersion) {
                this.loadLines();
            }
        });
    }

    openNewTransactionDialog() {
        this.dialog.add(FormViewDialog, {
            resModel: "account.bank.statement.line",
            title: "New Transaction",
            context: {
                default_journal_id: this.props.journalId,
                is_statement_line: true,
            },
            onRecordSaved: () => this.loadLines(),
        });
    }

    async loadLines(reset = true) {
        if (reset) this.state.offset = 0;
        this.state.loading = true;
        try {
            const result = await rpc('/odooer/bank_rec/get_lines', {
                journal_id: this.props.journalId,
                search_term: this.state.searchTerm,
                show_reconciled: this.state.showReconciled,
                limit: 50,
                offset: this.state.offset,
            });
            this.state.lines = result.lines;
            this.state.total = result.total;
        } finally {
            this.state.loading = false;
        }
    }

    onSearchInput(ev) {
        this.state.searchTerm = ev.target.value;
        this.loadLines();
    }

    toggleShowReconciled() {
        this.state.showReconciled = !this.state.showReconciled;
        this.loadLines();
    }

    selectLine(lineId) {
        this.props.onSelect(lineId);
    }
}
