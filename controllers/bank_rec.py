# License: LGPL-3
from odoo import http
from odoo.http import request


class BankRecController(http.Controller):

    @http.route('/odooer/bank_rec/get_lines', type='jsonrpc', auth='user', methods=['POST'])
    def get_lines(self, domain=None, limit=30, offset=0, **kwargs):
        return request.env['account.bank.statement.line'].get_bank_rec_lines(
            domain=domain, limit=limit, offset=offset,
        )

    @http.route('/odooer/bank_rec/get_rec_data', type='jsonrpc', auth='user', methods=['POST'])
    def get_rec_data(self, st_line_id, **kwargs):
        return request.env['account.bank.statement.line'].get_rec_data(st_line_id)

    @http.route('/odooer/bank_rec/search_partners', type='jsonrpc', auth='user', methods=['POST'])
    def search_partners(self, term, limit=10, **kwargs):
        return request.env['account.bank.statement.line'].search_partners(term, limit=limit)

    @http.route('/odooer/bank_rec/search_accounts', type='jsonrpc', auth='user', methods=['POST'])
    def search_accounts(self, term, limit=10, **kwargs):
        return request.env['account.bank.statement.line'].search_accounts(term, limit=limit)

    @http.route('/odooer/bank_rec/update_partner', type='jsonrpc', auth='user', methods=['POST'])
    def update_partner(self, st_line_id, partner_id, **kwargs):
        return request.env['account.bank.statement.line'].update_partner(st_line_id, partner_id)

    @http.route('/odooer/bank_rec/get_ar_ap_account', type='jsonrpc', auth='user', methods=['POST'])
    def get_ar_ap_account(self, partner_id, account_type, **kwargs):
        return request.env['account.bank.statement.line'].get_ar_ap_account(partner_id, account_type)

    @http.route('/odooer/bank_rec/get_candidates', type='jsonrpc', auth='user', methods=['POST'])
    def get_candidates(self, st_line_id, account_type=None,
                       extra_domain=None,
                       sort_field='date', sort_dir='desc',
                       offset=0, limit=15, **kwargs):
        return request.env['account.bank.statement.line'].get_candidate_amls(
            st_line_id, account_type=account_type,
            extra_domain=extra_domain,
            sort_field=sort_field, sort_dir=sort_dir,
            offset=offset, limit=limit,
        )

    @http.route('/odooer/bank_rec/get_accounts_by_ids', type='jsonrpc', auth='user', methods=['POST'])
    def get_accounts_by_ids(self, ids, **kwargs):
        accounts = request.env['account.account'].browse(ids)
        return [{'id': a.id, 'name': a.display_name} for a in accounts if a.exists()]

    @http.route('/odooer/bank_rec/get_partners_by_ids', type='jsonrpc', auth='user', methods=['POST'])
    def get_partners_by_ids(self, ids, **kwargs):
        partners = request.env['res.partner'].browse(ids)
        return [{'id': p.id, 'name': p.display_name} for p in partners if p.exists()]


    @http.route('/odooer/bank_rec/validate_lines', type='jsonrpc', auth='user', methods=['POST'])
    def validate_lines(self, st_line_id, pending_lines, **kwargs):
        return request.env['account.bank.statement.line'].validate_rec_lines(
            st_line_id, pending_lines,
        )

    @http.route('/odooer/bank_rec/unmatch', type='jsonrpc', auth='user', methods=['POST'])
    def unmatch(self, st_line_id, **kwargs):
        return request.env['account.bank.statement.line'].unmatch(st_line_id)

    @http.route('/odooer/bank_rec/delete_matched_line', type='jsonrpc', auth='user', methods=['POST'])
    def delete_matched_line(self, st_line_id, line_id, **kwargs):
        return request.env['account.bank.statement.line'].delete_matched_line(st_line_id, line_id)

    @http.route('/odooer/bank_rec/edit_matched_line', type='jsonrpc', auth='user', methods=['POST'])
    def edit_matched_line(self, st_line_id, line_id, label='', amount=None, **kwargs):
        return request.env['account.bank.statement.line'].edit_matched_line(
            st_line_id, line_id, label, amount,
        )

    @http.route('/odooer/bank_rec/edit_statement_line', type='jsonrpc', auth='user', methods=['POST'])
    def edit_statement_line(self, st_line_id, date=None, payment_ref='', amount=None, **kwargs):
        return request.env['account.bank.statement.line'].edit_statement_line(
            st_line_id, date, payment_ref, amount,
        )

    @http.route('/odooer/bank_rec/apply_liquidity_transfer', type='jsonrpc', auth='user', methods=['POST'])
    def apply_liquidity_transfer(self, st_line_id, **kwargs):
        return request.env['account.bank.statement.line'].apply_liquidity_transfer(st_line_id)

    @http.route('/odooer/bank_rec/delete_statement_line', type='jsonrpc', auth='user', methods=['POST'])
    def delete_statement_line(self, st_line_id, **kwargs):
        return request.env['account.bank.statement.line'].delete_statement_line(st_line_id)
