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
                'journal_name': self.name,
            },
        }


class AccountBankStatementLine(models.Model):
    _inherit = 'account.bank.statement.line'

    @api.model
    def get_bank_rec_lines(self, domain=None, limit=30, offset=0):
        """Returns statement lines for the bank rec widget left panel.

        domain: Odoo domain list (already fully computed by the JS SearchModel).
        """
        if domain is None:
            domain = []
        lines = self.search(domain, limit=limit, offset=offset, order='date desc, id desc')
        total = self.search_count(domain)
        result = []
        for line in lines:
            result.append({
                'id': line.id,
                'date': fields.Date.to_string(line.date) if line.date else '',
                'partner_name': line.partner_id.name or line.partner_name or '',
                'payment_ref': line.payment_ref or '',
                'move_name': line.move_id.name or '',
                'amount': line.amount,
                'currency_symbol': line.currency_id.symbol or '',
                'is_reconciled': line.is_reconciled,
                'to_check': not line.move_id.checked,
                'statement_name': line.statement_id.name or '',
                'journal_name': line.journal_id.name or '',
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
                'partner_id': line.partner_id.id or False,
                'partner_name': line.partner_id.name or '',
                'account_id': line.account_id.id,
                'account_name': line.account_id.name or '',
                'account_code': line.account_id.display_name or '',
                'label': line.name or '',
                'balance': line.balance,
                'debit': line.debit,
                'credit': line.credit,
                'amount_residual': line.amount_residual,
                'currency_symbol': line.currency_id.symbol or '',
            })

        return {
            'id': st_line.id,
            'move_id': st_line.move_id.id,
            'move_name': st_line.move_id.name or '',
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
            'transfer_account_id': st_line.company_id.transfer_account_id.id or False,
            'transfer_account_name': st_line.company_id.transfer_account_id.name or '',
            'transfer_account_code': st_line.company_id.transfer_account_id.code or '',
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
        """Set or clear the partner on a statement line.

        Enterprise uses force_delete=True + _try_auto_reconcile_statement_lines.
        We can't auto-reconcile, so we split by reconciliation state:

        - Not reconciled: mirror enterprise's force_delete=True approach.
          _synchronize_to_moves regenerates the default move lines (liquidity +
          suspense) with the updated partner — correct and expected behaviour.

        - Already reconciled: skip _synchronize_to_moves entirely so we don't
          destroy the user's manual matching entries.  Update the underlying
          move's partner_id directly (no line_ids touch needed).
        """
        st_line = self.browse(st_line_id)
        new_partner = partner_id or False
        if st_line.is_reconciled:
            # Preserve reconciled entries — bypass _synchronize_to_moves
            st_line.with_context(skip_account_move_synchronization=True).write({
                'partner_id': new_partner,
            })
            if st_line.move_id.partner_id.id != new_partner:
                st_line.move_id.with_context(skip_readonly_check=True).write({
                    'partner_id': new_partner,
                })
        else:
            # Mirror enterprise: force_delete lets _synchronize_to_moves
            # regenerate the liquidity/suspense lines with the new partner
            st_line.with_context(force_delete=True, skip_readonly_check=True).write({
                'partner_id': new_partner,
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
    def get_candidate_amls(self, st_line_id, account_type=None,
                           extra_domain=None,
                           sort_field='date', sort_dir='desc',
                           offset=0, limit=15):
        """Returns candidate journal entry lines for manual matching.
        Returns dict: {records: [...], total: int}.
        extra_domain: additional ORM domain from the client-side SearchModel.
        """
        SORT_FIELDS = {'date': 'date', 'amount': 'amount_residual', 'partner': 'partner_id', 'entry': 'move_id'}
        sort_col = SORT_FIELDS.get(sort_field, 'date')
        order = f'{sort_col} {sort_dir}, id desc'

        st_line = self.browse(st_line_id)
        domain = st_line._get_default_amls_matching_domain()

        # Only show candidates that make sense for the statement direction:
        # + statement (money in) needs debit candidates (Dr residual > 0)
        # - statement (money out) needs credit candidates (Cr residual < 0)
        if st_line.amount >= 0:
            domain += [('amount_residual', '>', 0)]
        else:
            domain += [('amount_residual', '<', 0)]

        # Filter by account type when requested (Receivable / Payable mode)
        if account_type:
            domain += [('account_id.account_type', '=', account_type)]

        # Merge client-side search domain (partner, account, text search, etc.)
        if extra_domain:
            domain += [list(item) if isinstance(item, (list, tuple)) else item for item in extra_domain]

        AmlModel = self.env['account.move.line']
        total = AmlModel.search_count(domain)
        amls = AmlModel.search(domain, limit=limit, offset=offset, order=order)
        records = []
        for aml in amls:
            records.append({
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
        return {'records': records, 'total': total}

    @api.model
    def validate_rec_lines(self, st_line_id, pending_lines):
        """Apply a list of reconciliation lines to a statement line.

        pending_lines: list of dicts:
          - type 'aml':     {'type':'aml', 'aml_id':N, 'label':str, 'amount':float}
          - type 'account': {'type':'account', 'account_id':N, 'partner_id':N|False,
                              'label':str, 'amount':float}

        Enterprise approach: Command.set(keep_lines) + Command.create(new_lines).
        The ORM batches all Command.create into a single create() call, so the
        balance check fires once after ALL new lines exist — not per-command.
        This is only safe because we write through move.line_ids (account.move.write),
        which sets check_move_validity=False on the shared StackMap before processing
        any commands, suppressing all nested balance checks during the operation.
        """
        st_line = self.browse(st_line_id)

        if not pending_lines:
            st_line.move_id.set_moves_checked(is_checked=True)
            return {'success': True}

        liquidity_lines, suspense_lines, other_lines = st_line._seek_for_lines()

        # money in (amount >= 0) → liquidity debit → counterpart credit → negative balance
        counterpart_sign = -1 if (st_line.amount or 0) >= 0 else 1

        # Remove reconciliation on existing suspense lines before replacing them
        suspense_lines.remove_move_reconcile()

        # Lines to keep: liquidity + any existing non-suspense other lines
        lines_to_set = liquidity_lines + other_lines

        # Build new lines to create; track AML lines for the reconciliation step
        aml_map = {}
        lines_to_add = []

        for idx, pl in enumerate(pending_lines):
            user_amount = abs(float(pl.get('amount') or 0))
            balance = counterpart_sign * user_amount

            if pl['type'] == 'aml':
                aml = self.env['account.move.line'].browse(int(pl['aml_id']))
                account_id = aml.account_id.id
                partner_id = aml.partner_id.id if aml.partner_id else (st_line.partner_id.id or False)
                aml_map[idx] = aml
            else:
                account_id = int(pl['account_id'])
                partner_id = (int(pl['partner_id']) if pl.get('partner_id')
                              else (st_line.partner_id.id or False))

            lines_to_add.append({
                'account_id': account_id,
                'partner_id': partner_id,
                'name': pl.get('label') or st_line.payment_ref or '/',
                'balance': balance,
                'amount_currency': balance,
                'currency_id': st_line.currency_id.id,
            })

        # Calculate remaining open balance after matching lines are applied
        open_balance = (
            sum(l.balance for l in lines_to_set)
            + sum(l['balance'] for l in lines_to_add)
        )

        # Command.set keeps the liquidity/other lines; suspense lines are removed.
        # Command.create items are batched by the ORM into one create() call.
        lines_commands = [Command.set(lines_to_set.ids)]
        for line in lines_to_add:
            lines_commands.append(Command.create(line))

        # If a residual balance remains, create a new suspense line for it
        company_currency = st_line.company_id.currency_id
        if not company_currency.is_zero(open_balance):
            suspense_account = (st_line.journal_id.suspense_account_id
                                or st_line.company_id.account_journal_suspense_account_id)
            if suspense_account:
                lines_commands.append(Command.create({
                    'account_id': suspense_account.id,
                    'partner_id': False,
                    'name': st_line.payment_ref or '/',
                    'balance': -open_balance,
                    'amount_currency': -open_balance,
                    'currency_id': st_line.currency_id.id,
                }))

        # Write through account.move so the outer _check_balanced sets
        # check_move_validity=False on the StackMap before any command runs.
        # All creates are batched → one balance check at the end when balanced.
        move = st_line.move_id.with_context(force_delete=True, skip_readonly_check=True)
        move.line_ids = lines_commands

        # Reconcile AML-type lines with their matching newly created move lines
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
        if company_currency.is_zero(open_balance):
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

    def apply_liquidity_transfer(self, st_line_id):
        """Swaps the suspense account on the statement move with the company's
        Inter-Banks Transfer Account.  No new journal entry is created."""
        st_line = self.browse(st_line_id)
        transfer_account = st_line.company_id.transfer_account_id
        if not transfer_account:
            return {'error': 'No Inter-Banks Transfer Account configured on company settings.'}

        _liq, suspense_lines, _other = st_line._seek_for_lines()
        if not suspense_lines:
            return {'error': 'No suspense line found on this statement line.'}

        for sline in suspense_lines:
            sline.account_id = transfer_account

        st_line.move_id._compute_checked()
        st_line._post_matching_message(_(
            "Liquidity transfer: suspense account replaced with %(account)s",
            account=transfer_account.display_name,
        ))
        return self.get_rec_data(st_line_id)

    def _adjust_suspense_after_line_change(self, st_line):
        """Recalculate the open balance and adjust (or create/remove) the suspense line."""
        st_line.invalidate_recordset()
        liq, suspense, other = st_line._seek_for_lines()
        open_balance = sum(l.balance for l in liq) + sum(l.balance for l in other)
        company_currency = st_line.company_id.currency_id
        move = st_line.move_id.with_context(force_delete=True, skip_readonly_check=True)
        if not company_currency.is_zero(open_balance):
            suspense_account = (st_line.journal_id.suspense_account_id
                                or st_line.company_id.account_journal_suspense_account_id)
            if suspense_account:
                if suspense:
                    move.write({'line_ids': [Command.update(suspense[0].id, {
                        'balance': -open_balance,
                        'amount_currency': -open_balance,
                    })]})
                else:
                    move.write({'line_ids': [Command.create({
                        'account_id': suspense_account.id,
                        'balance': -open_balance,
                        'amount_currency': -open_balance,
                        'currency_id': st_line.currency_id.id,
                        'name': st_line.payment_ref or '/',
                    })]})
        else:
            if suspense:
                move.write({'line_ids': [Command.delete(suspense[0].id)]})

    @api.model
    def delete_matched_line(self, st_line_id, line_id):
        """Remove a counterpart line from an unmatched statement line."""
        st_line = self.browse(st_line_id)
        if st_line.is_reconciled:
            return {'error': _('Transaction is already matched. Use Unmatch to modify it.')}
        move = st_line.move_id.with_context(force_delete=True, skip_readonly_check=True)
        move.write({'line_ids': [Command.delete(line_id)]})
        self._adjust_suspense_after_line_change(st_line)
        return self.get_rec_data(st_line_id)

    @api.model
    def edit_matched_line(self, st_line_id, line_id, label, amount=None):
        """Edit a counterpart line. Label is always editable; amount only when unmatched."""
        st_line = self.browse(st_line_id)
        line = self.env['account.move.line'].browse(line_id)
        vals = {'name': label or '/'}
        if not st_line.is_reconciled and amount is not None:
            vals['balance'] = float(amount)
            vals['amount_currency'] = float(amount)
        line.with_context(skip_readonly_check=True).write(vals)
        if not st_line.is_reconciled and amount is not None:
            self._adjust_suspense_after_line_change(st_line)
        return self.get_rec_data(st_line_id)

    @api.model
    def edit_statement_line(self, st_line_id, date, payment_ref, amount):
        """Edit a bank statement line. For unreconciled lines all fields are editable.
        For reconciled lines only payment_ref is safe to change."""
        st_line = self.browse(st_line_id)
        if st_line.is_reconciled:
            st_line.with_context(skip_readonly_check=True).write({
                'payment_ref': payment_ref or '/',
            })
        else:
            vals = {
                'payment_ref': payment_ref or '/',
            }
            if date:
                vals['date'] = date
            if amount is not None:
                vals['amount'] = float(amount)
            st_line.with_context(force_delete=True, skip_readonly_check=True).write(vals)
        return self.get_rec_data(st_line_id)

    @api.model
    def delete_statement_line(self, st_line_id):
        """Delete a bank statement line. Only allowed when not yet reconciled."""
        st_line = self.browse(st_line_id)
        if st_line.is_reconciled:
            return {'error': _('Cannot delete a reconciled statement line. Please undo reconciliation first.')}
        st_line.with_context(force_delete=True).unlink()
        return {'success': True}
