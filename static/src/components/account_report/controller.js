/** @odoo-module **/
import { rpc } from "@web/core/network/rpc";

/**
 * AccountReportController — handles all JSON-RPC calls to the backend.
 * Uses the Odoo 19 rpc() function directly (not a service).
 */
export class AccountReportController {
    constructor(reportId) {
        this.reportId = reportId;
    }

    async getOptions(previousOptions = null) {
        return rpc("/odooer_account/report/get_options", {
            report_id: this.reportId,
            previous_options: previousOptions,
        });
    }

    async getLines(options, offset = 0) {
        return rpc("/odooer_account/report/get_lines", {
            report_id: this.reportId,
            options,
            offset,
        });
    }

    async getChildren(lineId, options) {
        return rpc("/odooer_account/report/get_children", {
            report_id: this.reportId,
            line_id: lineId,
            options,
        });
    }
}
