# License: LGPL-3
from odoo import api, models, _, Command
from odoo.exceptions import UserError
from odoo.tools import float_is_zero


class AccountMoveLine(models.Model):
    _inherit = 'account.move.line'

    def action_reconcile(self):
        """Reconcile selected journal items from the list-view Action menu.

        - If the selected lines balance to zero → reconcile directly (silent).
        - If a write-off is required → open wizard so the user can supply the
          write-off account / label / date.
        """
        active_ids = self.env.context.get('active_ids', self.ids)
        lines = self.env['account.move.line'].browse(active_ids)

        # Strip zero-balance lines — they don't contribute to reconciliation.
        lines = lines.filtered(lambda l: l.balance or l.amount_currency)
        if not lines:
            raise UserError(_("All selected journal items have zero balance."))

        # All lines must belong to reconcilable accounts.
        non_reconcilable = lines.filtered(lambda l: not l.account_id.reconcile)
        if non_reconcilable:
            accs = ', '.join(non_reconcilable.mapped('account_id.display_name'))
            raise UserError(_(
                "The following accounts do not allow reconciliation:\n%s\n\n"
                "Enable 'Allow Reconciliation' on the account to proceed."
            ) % accs)

        # All lines must be on the same account.
        accounts = lines.account_id
        if len(accounts) > 1:
            raise UserError(_(
                "Please select journal items from the same account.\n\n"
                "Selected accounts: %s"
            ) % ', '.join(accounts.mapped('display_name')))

        currency = lines[0].currency_id or lines[0].company_id.currency_id
        total_residual = sum(lines.mapped('amount_residual'))

        if float_is_zero(total_residual, precision_rounding=currency.rounding):
            lines.reconcile()
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Reconciled'),
                    'message': _('%d journal items reconciled successfully.') % len(lines),
                    'type': 'success',
                    'sticky': False,
                },
            }

        # Write-off required — open wizard.
        wizard = self.env['odooer.account.reconcile.wizard'].create({
            'account_id': accounts.id,
            'currency_id': currency.id,
            'move_line_ids': [Command.set(lines.ids)],
        })
        return {
            'name': _('Reconcile — Write-Off Required'),
            'type': 'ir.actions.act_window',
            'res_model': 'odooer.account.reconcile.wizard',
            'res_id': wizard.id,
            'view_mode': 'form',
            'target': 'new',
        }
