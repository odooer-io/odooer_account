/** @odoo-module **/
import { Component, useState, onWillStart, onWillUpdateProps } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";
import { SearchBar } from "@web/search/search_bar/search_bar";

const PAGE_SIZE = 30;

export class BankRecTransactionList extends Component {
    static template = "odooer_account.BankRecTransactionList";
    static components = { SearchBar };
    static props = {
        domain: { type: Array, optional: true },
        journalId: { type: [Number, { value: null }], optional: true },
        status: { type: String, optional: true },
        onSetStatus: Function,
        selectedLineId: { type: [Number, { value: null }], optional: true },
        onSelect: Function,
        onLineReconciled: Function,
        listVersion: { type: Number, optional: true },
    };

    setup() {
        this.dialog = useService("dialog");
        this.state = useState({ lines: [], total: 0, loading: false, page: 1 });

        onWillStart(() => this.loadLines(this.props.domain || []));

        onWillUpdateProps((nextProps) => {
            const domainChanged =
                JSON.stringify(nextProps.domain) !== JSON.stringify(this.props.domain);
            const versionChanged = nextProps.listVersion !== this.props.listVersion;
            if (domainChanged || versionChanged) {
                this.state.page = 1;
                this.loadLines(nextProps.domain || []);
            }
        });
    }

    async loadLines(domain, resetPage = true) {
        if (resetPage) this.state.page = 1;
        this.state.loading = true;
        try {
            const result = await rpc('/odooer/bank_rec/get_lines', {
                domain: domain ?? this.props.domain ?? [],
                limit: PAGE_SIZE,
                offset: (this.state.page - 1) * PAGE_SIZE,
            });
            this.state.lines = result.lines;
            this.state.total = result.total;
        } finally {
            this.state.loading = false;
        }
    }

    get totalPages() {
        return Math.max(1, Math.ceil(this.state.total / PAGE_SIZE));
    }

    prevPage() {
        if (this.state.page > 1) {
            this.state.page--;
            this.loadLines(this.props.domain || [], false);
        }
    }

    nextPage() {
        if (this.state.page < this.totalPages) {
            this.state.page++;
            this.loadLines(this.props.domain || [], false);
        }
    }

    openNewTransactionDialog() {
        this.dialog.add(FormViewDialog, {
            resModel: "account.bank.statement.line",
            title: "New Transaction",
            context: { default_journal_id: this.props.journalId, is_statement_line: true },
            onRecordSaved: () => this.loadLines(this.props.domain || []),
        });
    }

    selectLine(lineId) {
        this.props.onSelect(lineId);
    }
}
