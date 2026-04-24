# License: LGPL-3
from odoo import http
from odoo.http import request


class BankRecController(http.Controller):

    @http.route('/odooer/bank_rec/get_lines', type='jsonrpc', auth='user', methods=['POST'])
    def get_lines(self, journal_id, search_term='', show_reconciled=False, limit=50, offset=0, **kwargs):
        return request.env['account.bank.statement.line'].get_bank_rec_lines(
            journal_id, search_term=search_term, show_reconciled=show_reconciled,
            limit=limit, offset=offset,
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
    def get_candidates(self, st_line_id, search_term='', limit=20, **kwargs):
        return request.env['account.bank.statement.line'].get_candidate_amls(
            st_line_id, search_term=search_term, limit=limit,
        )

    @http.route('/odooer/bank_rec/validate_lines', type='jsonrpc', auth='user', methods=['POST'])
    def validate_lines(self, st_line_id, pending_lines, **kwargs):
        return request.env['account.bank.statement.line'].validate_rec_lines(
            st_line_id, pending_lines,
        )

    @http.route('/odooer/bank_rec/unmatch', type='jsonrpc', auth='user', methods=['POST'])
    def unmatch(self, st_line_id, **kwargs):
        return request.env['account.bank.statement.line'].unmatch(st_line_id)
