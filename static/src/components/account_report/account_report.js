/** @odoo-module **/
/**
 * AccountReport root OWL component.
 * Mounts the full report viewer: filters bar, buttons bar, and the line tree.
 */
import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { AccountReportController } from "./controller";
import { Filters } from "./filters/filters";
import { ButtonsBar } from "./buttons_bar/buttons_bar";
import { Line } from "./line/line";

export class AccountReport extends Component {
    static template = "odooer_account.AccountReport";
    static components = { Filters, ButtonsBar, Line };

    setup() {
        this.action = useService("action");
        this.notification = useService("notification");

        // reportId is passed via the client action context
        this.reportId = this.props.action?.context?.report_id || null;

        this.controller = new AccountReportController(this.reportId);
        this.state = useState({
            loading: true,
            options: {},
            lines: [],
            loadMoreOffset: 0,
            loadMoreRemaining: 0,
        });

        onWillStart(async () => {
            await this._loadOptions();
            await this._loadLines();
        });
    }

    // ── Data loading ─────────────────────────────────────────────────────────

    async _loadOptions(previousOptions = null) {
        this.state.options = await this.controller.getOptions(previousOptions);
    }

    async _loadLines() {
        this.state.loading = true;
        try {
            const result = await this.controller.getLines(this.state.options, 0);
            this.state.lines = result.lines.filter(Boolean);
            this.state.loadMoreOffset = result.load_more_offset;
            this.state.loadMoreRemaining = result.load_more_remaining;
        } finally {
            this.state.loading = false;
        }
    }

    async _loadMore() {
        const result = await this.controller.getLines(
            this.state.options,
            this.state.loadMoreOffset
        );
        this.state.lines = [...this.state.lines, ...result.lines.filter(Boolean)];
        this.state.loadMoreOffset = result.load_more_offset;
        this.state.loadMoreRemaining = result.load_more_remaining;
    }

    // ── Event handlers ───────────────────────────────────────────────────────

    async onOptionsChanged(newOptions) {
        this.state.options = { ...this.state.options, ...newOptions };
        await this._loadLines();
    }

    async onToggleLine(lineId) {
        const unfolded = this.state.options.unfolded_lines || [];
        if (unfolded.includes(lineId)) {
            this.state.options = {
                ...this.state.options,
                unfolded_lines: unfolded.filter((id) => id !== lineId),
            };
            // Remove children from state
            this.state.lines = this._removeChildren(this.state.lines, lineId);
        } else {
            this.state.options = {
                ...this.state.options,
                unfolded_lines: [...unfolded, lineId],
            };
            const children = await this.controller.getChildren(lineId, this.state.options);
            this.state.lines = this._insertChildren(this.state.lines, lineId, children);
        }
    }

    async onExportXlsx() {
        const url =
            `/odooer_account/report/export_xlsx` +
            `?report_id=${this.reportId}` +
            `&options=${encodeURIComponent(JSON.stringify(this.state.options))}`;
        window.open(url, "_blank");
    }

    // ── Tree helpers ─────────────────────────────────────────────────────────

    _removeChildren(lines, parentId) {
        const parent = lines.find((l) => l.id === parentId);
        if (!parent) return lines;
        const parentLevel = parent.level;
        const parentIdx = lines.indexOf(parent);
        const result = [...lines];
        let i = parentIdx + 1;
        while (i < result.length && result[i].level > parentLevel) {
            i++;
        }
        result.splice(parentIdx + 1, i - parentIdx - 1);
        return result;
    }

    _insertChildren(lines, parentId, children) {
        const parentIdx = lines.findIndex((l) => l.id === parentId);
        if (parentIdx === -1) return lines;
        const result = [...lines];
        result.splice(parentIdx + 1, 0, ...children.filter(Boolean));
        return result;
    }

    get hasLoadMore() {
        return this.state.loadMoreRemaining > 0;
    }
}

// Register as a client action
registry.category("actions").add("odooer_account_report", AccountReport);
