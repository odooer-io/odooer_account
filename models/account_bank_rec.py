# License: LGPL-3
import logging
from dateutil.relativedelta import relativedelta
from odoo import api, fields, models, _
from odoo.fields import Command
from odoo.tools import float_is_zero

_logger = logging.getLogger(__name__)


class AccountJournal(models.Model):
    _inherit = 'account.journal'

    def action_open_bank_transactions(self):
        """Opens the bank reconciliation widget for this journal."""
        self.ensure_one()
        return {
            'type': 'ir.actions.client',
            'tag': 'odooer_bank_rec_widget',
            'name': self.name,
            'context': {
                'journal_id': self.id,
                'default_journal_id': self.id,
            },
        }


class AccountBankStatementLine(models.Model):
    _inherit = 'account.bank.statement.line'

    @api.model
    def get_bank_rec_lines(self, journal_id, search_term='', show_reconciled=False, limit=50, offset=0):
        """Returns statement lines for the bank rec widget left panel."""
        domain = [('journal_id', '=', journal_id)]
        if not show_reconciled:
            domain += [('is_reconciled', '=', False)]
        if search_term:
            domain += ['|', '|',
                ('payment_ref', 'ilike', search_term),
                ('partner_id.name', 'ilike', search_term),
                ('amount', '=', search_term),
            ]
        lines = self.search(domain, limit=limit, offset=offset, order='date desc, id desc')
        total = self.search_count(domain)
        result = []
        for line in lines:
            result.append({
                'id': line.id,
                'date': fields.Date.to_string(line.date) if line.date else '',
                'partner_name': line.partner_id.name or line.partner_name or '',
                'payment_ref': line.payment_ref or '',
                'amount': line.amount,
                'currency_symbol': line.currency_id.symbol or '',
                'is_reconciled': line.is_reconciled,
                'to_check': not line.move_id.checked,
                'statement_name': line.statement_id.name or '',
            })
        return {'lines': result, 'total': total}

    @api.model
    def get_rec_data(self, st_line_id):
        """Returns reconciliation data for the right panel."""
        st_line = self.browse(st_line_id)
        _liq, _suspense, other_lines = st_line._seek_for_lines()

        matched = []
        for line in other_lines:
            matched.append({
                'id': line.id,
                'date': fields.Date.to_string(line.date) if line.date else '',
                'move_name': line.move_id.name or '',
                'partner_name': line.partner_id.name or '',
                'account_name': line.account_id.name or '',
                'account_code': line.account_id.display_name or '',
                'label': line.name or '',
                'debit': line.debit,
                'credit': line.credit,
                'amount_residual': line.amount_residual,
                'currency_symbol': line.currency_id.symbol or '',
            })

        return {
            'id': st_line.id,
            'date': fields.Date.to_string(st_line.date) if st_line.date else '',
            'partner_id': st_line.partner_id.id or False,
            'partner_name': st_line.partner_id.name or st_line.partner_name or '',
            'payment_ref': st_line.payment_ref or '',
            'amount': st_line.amount,
            'amount_residual': st_line.amount_residual,
            'currency_symbol': st_line.currency_id.symbol or '',
            'is_reconciled': st_line.is_reconciled,
            'to_check': not st_line.move_id.checked,
            'journal_name': st_line.journal_id.name or '',
            'statement_name': st_line.statement_id.name or '',
            'matched_lines': matched,
        }

    @api.model
    def search_partners(self, term, limit=10):
        """Search partners by name for the partner typeahead."""
        results = self.env['res.partner'].name_search(term, limit=limit)
        return [{'id': r[0], 'name': r[1]} for r in results]

    @api.model
    def search_accounts(self, term, limit=10):
        """Search chart of accounts for the account typeahead."""
        domain = [
            ('active', '=', True),
            ('account_type', 'not in', ['off_balance']),
            '|', ('name', 'ilike', term), ('code', 'ilike', term),
        ]
        accounts = self.env['account.account'].search(domain, limit=limit)
        return [{'id': a.id, 'name': a.display_name} for a in accounts]

    @api.model
    def update_partner(self, st_line_id, partner_id):
        """Set or clear the partner on a statement line."""
        st_line = self.browse(st_line_id)
        st_line.with_context(skip_readonly_check=True).write({
            'partner_id': partner_id or False,
        })
        return self.get_rec_data(st_line_id)

    @api.model
    def get_ar_ap_account(self, partner_id, account_type):
        """Return the AR or AP account for a partner.
        account_type: 'asset_receivable' | 'liability_payable'
        """
        partner = self.env['res.partner'].browse(partner_id)
        if account_type == 'asset_receivable':
            account = partner.property_account_receivable_id
        else:
            account = partner.property_account_payable_id
        if not account:
            account = self.env['account.account'].search([
                ('account_type', '=', account_type),
                ('active', '=', True),
            ], limit=1)
        if not account:
            return False
        return {'id': account.id, 'name': account.display_name, 'code': account.code}

    @api.model
    def get_candidate_amls(self, st_line_id, search_term='', limit=20):
        """Returns candidate journal entry lines for manual matching.
        Automatically filters by partner when the statement line has one set.
        """
        st_line = self.browse(st_line_id)
        domain = st_line._get_default_amls_matching_domain()

        # Filter by partner when set (per user requirement)
        if st_line.partner_id:
            domain += [('partner_id', '=', st_line.partner_id.id)]

        if search_term:
            domain += ['|', '|',
                ('move_id.name', 'ilike', search_term),
                ('partner_id.name', 'ilike', search_term),
                ('name', 'ilike', search_term),
            ]
        amls = self.env['account.move.line'].search(domain, limit=limit, order='date desc')
        result = []
        for aml in amls:
            result.append({
                'id': aml.id,
                'date': fields.Date.to_string(aml.date) if aml.date else '',
                'move_name': aml.move_id.name or '',
                'partner_name': aml.partner_id.name or '',
                'account_display': aml.account_id.display_name or '',
                'label': aml.name or '',
                'debit': aml.debit,
                'credit': aml.credit,
                'amount_residual': aml.amount_residual,
                'currency_symbol': aml.currency_id.symbol or '',
            })
        return result

    @api.model
    def validate_rec_lines(self, st_line_id, pending_lines):
        """Apply a list of reconciliation lines to a statement line.

        pending_lines: list of dicts:
          - type 'aml':     {'type':'aml', 'aml_id':N, 'label':str, 'amount':float}
          - type 'account': {'type':'account', 'account_id':N, 'partner_id':N|False,
                              'label':str, 'amount':float}

        Strategy: UPDATE existing suspense lines in-place where possible so the
        chatter shows "Journal Item updated" (field diff) rather than delete+create.
        Extra suspense lines are unlinked with force_delete; extra pending lines
        beyond the suspense count are created as new move lines.
        """
        st_line = self.browse(st_line_id)

        if not pending_lines:
            st_line.move_id.set_moves_checked(is_checked=True)
            return {'success': True}

        _liq, suspense_lines, _other = st_line._seek_for_lines()

        # Direction: counterpart sign is opposite to the transaction amount.
        # money in (amount > 0) → liquidity debit → counterpart is credit → negative amount_currency
        counterpart_sign = -1 if (st_line.amount or 0) >= 0 else 1

        # Step 1: Unlink reconciliation on suspense lines
        suspense_lines.remove_move_reconcile()

        # Step 2: Build per-pending-line vals + track which are AML type
        aml_map = {}
        line_vals_list = []

        for idx, pl in enumerate(pending_lines):
            user_amount = abs(float(pl.get('amount') or 0))
            amount_currency = counterpart_sign * user_amount

            if pl['type'] == 'aml':
                aml = self.env['account.move.line'].browse(int(pl['aml_id']))
                account_id = aml.account_id.id
                partner_id = aml.partner_id.id if aml.partner_id else (st_line.partner_id.id or False)
                aml_map[idx] = aml
            else:
                account_id = int(pl['account_id'])
                partner_id = (int(pl['partner_id']) if pl.get('partner_id')
                              else (st_line.partner_id.id or False))

            line_vals_list.append({
                'account_id': account_id,
                'partner_id': partner_id,
                'name': pl.get('label') or st_line.payment_ref or '/',
                'amount_currency': amount_currency,
                'currency_id': st_line.currency_id.id,
                'debit': max(0.0, amount_currency),
                'credit': max(0.0, -amount_currency),
            })

        # Step 3: Match pending lines to existing suspense lines.
        # UPDATE in-place → "Journal Item updated" in chatter (no delete/create).
        # CREATE for extra pending lines beyond existing suspense count.
        # UNLINK extra suspense lines if there are fewer pending lines than suspense lines.
        suspense_list = list(suspense_lines)
        line_cmds = []

        for i, vals in enumerate(line_vals_list):
            if i < len(suspense_list):
                line_cmds.append(Command.update(suspense_list[i].id, vals))
            else:
                line_cmds.append(Command.create(vals))

        for extra in suspense_list[len(line_vals_list):]:
            line_cmds.append(Command.unlink(extra.id))

        st_line.with_context(force_delete=True, skip_readonly_check=True).write({
            'line_ids': line_cmds,
        })

        # Step 4: Reconcile AML-type lines with their matching updated/created move lines
        if aml_map:
            st_line.invalidate_recordset()
            _liq2, _sus2, new_other = st_line._seek_for_lines()
            used_ids = set()

            for idx, aml in aml_map.items():
                if not aml.account_id.reconcile:
                    continue
                candidates = new_other.filtered(
                    lambda l: l.account_id.id == aml.account_id.id
                    and l.id not in used_ids
                    and not l.reconciled
                )
                if candidates:
                    new_line = candidates[0]
                    used_ids.add(new_line.id)
                    try:
                        (new_line | aml).reconcile()
                    except Exception as e:
                        _logger.warning('Bank rec: reconcile failed for line %s / AML %s: %s',
                                        new_line.id, aml.id, e)

        st_line.move_id.set_moves_checked(is_checked=True)
        st_line._post_matching_message(_("Matching done"))
        return {'success': True}

    def _post_matching_message(self, body):
        """Post a chatter message on the move, skipping duplicates within 5 minutes."""
        self.ensure_one()
        recent = self.move_id.message_ids.filtered_domain([
            ('author_id', '=', self.env.user.partner_id.id),
            ('create_date', '>=', fields.Datetime.now() - relativedelta(minutes=5)),
            ('body', 'ilike', body),
        ])
        if not recent:
            self.move_id.message_post(
                body=body,
                author_id=self.env.user.partner_id.id,
            )

    @api.model
    def unmatch(self, st_line_id):
        """Removes all reconciliation from a statement line."""
        st_line = self.browse(st_line_id)
        st_line.action_undo_reconciliation()
        st_line._post_matching_message(_("Matching unreconciled"))
        return {'success': True}
