# License: LGPL-3
from odoo import api, fields, models, _, Command
from odoo.exceptions import UserError


class OdooerAccountReconcileWizard(models.TransientModel):
    """Wizard opened when selected journal items don't balance to zero.
    Lets the user supply write-off details so the reconciliation can complete.
    """
    _name = 'odooer.account.reconcile.wizard'
    _description = 'Reconcile Journal Items (Write-Off)'

    # ── Lines being reconciled ──────────────────────────────────────────────
    move_line_ids = fields.Many2many(
        'account.move.line',
        string='Journal Items',
        readonly=True,
    )

    # ── Reconciliation context (set by action_reconcile) ────────────────────
    account_id = fields.Many2one(
        'account.account',
        string='Account',
        readonly=True,
    )
    currency_id = fields.Many2one(
        'res.currency',
        string='Currency',
        readonly=True,
    )

    # ── Computed summary ────────────────────────────────────────────────────
    total_debit = fields.Monetary(
        compute='_compute_totals',
        currency_field='currency_id',
        string='Total Debit',
    )
    total_credit = fields.Monetary(
        compute='_compute_totals',
        currency_field='currency_id',
        string='Total Credit',
    )
    writeoff_amount = fields.Monetary(
        compute='_compute_totals',
        currency_field='currency_id',
        string='Write-Off Amount',
        help="Net residual amount that cannot be matched; this will be posted to the write-off account.",
    )

    # ── Write-off details ───────────────────────────────────────────────────
    writeoff_account_id = fields.Many2one(
        'account.account',
        string='Write-Off Account',
        domain="[('account_type', 'not in', ['asset_receivable', 'liability_payable', 'off_balance'])]",
    )
    writeoff_journal_id = fields.Many2one(
        'account.journal',
        string='Journal',
        domain="[('type', 'in', ['general', 'bank', 'cash'])]",
    )
    writeoff_label = fields.Char(string='Label', default='Write-Off')
    writeoff_date = fields.Date(string='Date', default=fields.Date.context_today)

    # ── Computed ─────────────────────────────────────────────────────────────
    @api.depends('move_line_ids')
    def _compute_totals(self):
        for wizard in self:
            wizard.total_debit = sum(wizard.move_line_ids.mapped('debit'))
            wizard.total_credit = sum(wizard.move_line_ids.mapped('credit'))
            wizard.writeoff_amount = abs(sum(wizard.move_line_ids.mapped('amount_residual')))

    @api.onchange('account_id')
    def _onchange_account_id(self):
        """Default the write-off journal to the company's default misc journal."""
        if not self.writeoff_journal_id:
            self.writeoff_journal_id = self.env['account.journal'].search(
                [('type', '=', 'general')], limit=1
            )

    def action_reconcile(self):
        """Create the write-off entry and reconcile all lines together."""
        self.ensure_one()
        if not self.account_id or not self.move_line_ids:
            raise UserError(_("Missing reconciliation data."))
        if not self.writeoff_account_id:
            raise UserError(_("Please select a Write-Off Account."))

        total_residual = sum(self.move_line_ids.mapped('amount_residual'))
        journal = self.writeoff_journal_id or self.env['account.journal'].search(
            [('type', '=', 'general')], limit=1
        )
        if not journal:
            raise UserError(_("No general journal found. Please specify a journal."))

        # Write-off entry: two lines
        #   Line 1 — on the *same* reconcilable account (to absorb the imbalance)
        #   Line 2 — on the *write-off* account (the actual expense/income)
        if total_residual > 0:
            # Net debit on reconcilable account → credit it away
            rec_debit, rec_credit = 0.0, abs(total_residual)
            wo_debit, wo_credit = abs(total_residual), 0.0
        else:
            # Net credit on reconcilable account → debit it away
            rec_debit, rec_credit = abs(total_residual), 0.0
            wo_debit, wo_credit = 0.0, abs(total_residual)

        writeoff_move = self.env['account.move'].create({
            'ref': self.writeoff_label or 'Write-Off',
            'date': self.writeoff_date,
            'journal_id': journal.id,
            'line_ids': [
                Command.create({
                    'account_id': self.account_id.id,
                    'name': self.writeoff_label or 'Write-Off',
                    'debit': rec_debit,
                    'credit': rec_credit,
                }),
                Command.create({
                    'account_id': self.writeoff_account_id.id,
                    'name': self.writeoff_label or 'Write-Off',
                    'debit': wo_debit,
                    'credit': wo_credit,
                }),
            ],
        })
        writeoff_move._post(soft=False)

        # Pick the line from the write-off entry that sits on the reconcilable account
        writeoff_line = writeoff_move.line_ids.filtered(
            lambda l: l.account_id == self.account_id
        )
        if not writeoff_line:
            raise UserError(_("Write-off entry was created but no line found on account %s.") %
                            self.account_id.display_name)

        # Reconcile all lines together
        (self.move_line_ids | writeoff_line).reconcile()

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Reconciled'),
                'message': _('Journal items reconciled. Write-off entry: %s') % writeoff_move.name,
                'type': 'success',
                'sticky': False,
            },
        }

