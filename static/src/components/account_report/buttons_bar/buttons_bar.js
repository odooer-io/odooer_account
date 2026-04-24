/** @odoo-module **/
import { Component } from "@odoo/owl";

export class ButtonsBar extends Component {
    static template = "odooer_account.ButtonsBar";

    onExportXlsx() {
        this.props.onExportXlsx();
    }
}
