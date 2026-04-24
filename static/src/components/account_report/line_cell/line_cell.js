/** @odoo-module **/
import { Component } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

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
        // Leaf-level monetary cells can drill down to journal items
        const line = this.props.line;
        return !line.has_children && this.props.col.figure_type === "monetary";
    }

    onCellClick() {
        if (!this.isClickable) return;
        const line = this.props.line;
        const options = this.props.options;
        this.action.doAction({
            type: "ir.actions.act_window",
            name: line.name,
            res_model: "account.move.line",
            view_mode: "list,form",
            views: [[false, "list"], [false, "form"]],
            domain: [
                ["date", ">=", options.date?.date_from || false],
                ["date", "<=", options.date?.date_to || false],
                ["move_id.state", "!=", "cancel"],
            ],
            context: { search_default_group_by_account: 1 },
        });
    }
}
