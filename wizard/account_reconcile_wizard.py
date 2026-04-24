# License: LGPL-3
from odoo import models, fields


class AccountReconcileWizard(models.TransientModel):
    """Placeholder for the bank reconciliation session wizard."""

    _name = 'odooer.account.reconcile.wizard'
    _description = 'Bank Reconciliation Wizard'

    journal_id = fields.Many2one('account.journal', string='Bank Journal', required=True)
    date_from = fields.Date(string='From Date')
    date_to = fields.Date(string='To Date', default=fields.Date.context_today)
