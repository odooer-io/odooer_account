/** @odoo-module **/
import { Component } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";

export class LineCell extends Component {
    static template = "odooer_account.LineCell";

    setup() {
        this.action = useService("action");
    }

    get formattedValue() {
        const col = this.props.col;
        if (col.no_format === null || col.no_format === undefined) return "";
        return col.name;
    }

    get isClickable() {
        const { col, line } = this.props;
        // Only non-zero monetary cells on leaf lines (or groupby sub-lines) are clickable
        return (
            !line.has_children &&
            col.figure_type === "monetary" &&
            col.no_format !== 0 &&
            col.no_format !== null &&
            col.no_format !== undefined
        );
    }

    async onCellClick() {
        if (!this.isClickable) return;
        const { line, options, reportId } = this.props;
        const action = await rpc("/odooer_account/report/get_audit_action", {
            report_id: reportId,
            line_id: line.id,
            options: options,
            audit_parent_line_id: line.audit_parent_line_id || null,
            audit_extra_domain: line.audit_extra_domain || null,
        });
        if (action && action.type) {
            this.action.doAction(action);
        }
    }
}
