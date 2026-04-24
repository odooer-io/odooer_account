# License: LGPL-3
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class ResCompany(models.Model):
    _inherit = 'res.company'

    # ── Fiscal lock dates ────────────────────────────────────────────────────
    fiscalyear_lock_date = fields.Date(
        string='Lock Date for Non-Advisers',
        help='Journal entries before this date are locked for all users except advisers.',
    )
    period_lock_date = fields.Date(
        string='Lock Date',
        help='Journal entries before (or on) this date are locked for everyone, including advisers.',
    )
    tax_lock_date = fields.Date(
        string='Tax Return Lock Date',
        help='Journal entries affecting tax accounts before this date are locked.',
    )


class AccountMove(models.Model):
    _inherit = 'account.move'

    def _check_lock_date(self):
        """Raise if the move date is before any applicable lock date."""
        for move in self:
            company = move.company_id
            user = self.env.user

            # Hard lock — nobody can post
            if company.period_lock_date and move.date <= company.period_lock_date:
                raise UserError(_(
                    'The date of the entry "%(name)s" (%(date)s) is before the lock date '
                    '(%(lock)s). Please adjust the date or ask an adviser to unlock the period.',
                    name=move.name or _('New'),
                    date=move.date,
                    lock=company.period_lock_date,
                ))

            # Soft lock — only advisers can post
            if (
                company.fiscalyear_lock_date
                and move.date <= company.fiscalyear_lock_date
                and not user.has_group('account.group_account_manager')
            ):
                raise UserError(_(
                    'The date of the entry "%(name)s" (%(date)s) is before the adviser '
                    'lock date (%(lock)s). Only accounting advisers may post before this date.',
                    name=move.name or _('New'),
                    date=move.date,
                    lock=company.fiscalyear_lock_date,
                ))

    def action_post(self):
        self._check_lock_date()
        return super().action_post()
