/** @odoo-module **/
import { Component } from "@odoo/owl";
import { LineCell } from "../line_cell/line_cell";

export class Line extends Component {
    static template = "odooer_account.Line";
    static components = { LineCell };

    get isExpanded() {
        return (this.props.options.unfolded_lines || []).includes(this.props.line.id);
    }

    get foldIcon() {
        if (!this.props.line.has_children) return "";
        return this.isExpanded ? "fa-caret-down" : "fa-caret-right";
    }

    onFoldClick() {
        if (this.props.line.has_children) {
            this.props.onToggle(this.props.line.id);
        }
    }
}
