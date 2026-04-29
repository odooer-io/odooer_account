# Reserved for future account.move extensions.
from odoo import api, fields, models


class AccountMove(models.Model):
    _inherit = 'account.move'

    bank_statement_line_count = fields.Integer(
        compute='_compute_bank_statement_line_count',
        string='Statement Lines',
    )

    def _compute_bank_statement_line_count(self):
        for move in self:
            move.bank_statement_line_count = self.env['account.bank.statement.line'].search_count([
                ('move_id', '=', move.id),
            ])

    def action_open_bank_rec(self):
        """Open the bank reconciliation widget pre-filtered to this statement line."""
        self.ensure_one()
        st_line = self.env['account.bank.statement.line'].search(
            [('move_id', '=', self.id)], limit=1,
        )
        if not st_line:
            return
        return {
            'type': 'ir.actions.client',
            'tag': 'odooer_bank_rec_widget',
            'name': st_line.journal_id.name,
            'context': {
                'journal_id': st_line.journal_id.id,
                'default_journal_id': st_line.journal_id.id,
                'journal_name': st_line.journal_id.name,
                'active_st_line_id': st_line.id,
                'active_move_name': self.name,
            },
        }
