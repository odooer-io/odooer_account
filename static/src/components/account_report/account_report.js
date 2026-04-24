/** @odoo-module **/
/**
 * AccountReport root OWL component.
 * Mounts the full report viewer: filters bar, buttons bar, and the line tree.
 *
 * State persistence mirrors the enterprise approach: full options are saved to
 * sessionStorage on every change (including initial load).  This gives us free
 * page-refresh and browser-back restoration, just like enterprise.
 */
import { Component, useState, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { useSetupAction } from "@web/search/action_hook";
import { user } from "@web/core/user";
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

        this.reportId = this.props.action?.context?.report_id || null;

        this.controller = new AccountReportController(this.reportId);
        this.state = useState({
            loading: true,
            options: {},
            lines: [],
            loadMoreOffset: 0,
            loadMoreRemaining: 0,
        });

        // Register with Odoo's action stack — getLocalState is called before doAction
        // navigates away; the saved flag tells the action service this action has local
        // state so it preserves it in the breadcrumb.  Do NOT pass rootRef here: our
        // template has no t-ref="root", so rootRef.el would be null and trigger a
        // querySelector crash inside useSetupAction's scroll-capture logic.
        useSetupAction({
            getLocalState: () => ({ has_state: true }),
        });

        onWillStart(async () => {
            // If we have a saved session, pass it as previousOptions so the backend
            // merges user-chosen filters (date, show_draft, etc.) with any schema changes.
            const saved = this._sessionOptions();
            await this._loadOptions(saved);
            // unfolded_lines is frontend-only; backend doesn't echo it back.
            if (saved?.unfolded_lines?.length) {
                this.state.options.unfolded_lines = [...saved.unfolded_lines];
            }
            await this._loadLines();
            // Always persist after initial load so page-refresh restores state
            // even before the user changes any filters.
            this._saveSession();
        });
    }

    // ── Session storage (mirrors enterprise saveSessionOptions pattern) ────────

    _sessionKey() {
        // Include company ID (same pattern as enterprise) so options don't bleed across company switches.
        const cid = user.activeCompany?.id || 0;
        return `odooer_account.report:${this.reportId}:${cid}`;
    }

    _hasSession() {
        return Boolean(sessionStorage.getItem(this._sessionKey()));
    }

    _sessionOptions() {
        try {
            const raw = sessionStorage.getItem(this._sessionKey());
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    _saveSession() {
        if (!this.reportId) return;
        try {
            // Save the FULL options object — same as enterprise saveSessionOptions().
            sessionStorage.setItem(this._sessionKey(), JSON.stringify(this.state.options));
        } catch (_) {}
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
        this._saveSession();
        await this._loadLines();
    }

    async onToggleLine(lineId) {
        const unfolded = this.state.options.unfolded_lines || [];
        if (unfolded.includes(lineId)) {
            this.state.options = {
                ...this.state.options,
                unfolded_lines: unfolded.filter((id) => id !== lineId),
            };
            this.state.lines = this._removeChildren(this.state.lines, lineId);
        } else {
            this.state.options = {
                ...this.state.options,
                unfolded_lines: [...unfolded, lineId],
            };
            const children = await this.controller.getChildren(lineId, this.state.options);
            this.state.lines = this._insertChildren(this.state.lines, lineId, children);
        }
        this._saveSession();
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
