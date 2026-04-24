# License: LGPL-3
import json

from odoo import http
from odoo.http import request, Response


class AccountReportController(http.Controller):

    @http.route('/odooer_account/report/get_lines', type='jsonrpc', auth='user')
    def get_lines(self, report_id, options, offset=0):
        report = request.env['account.report'].browse(int(report_id))
        return report.get_report_lines(options, offset=int(offset))

    @http.route('/odooer_account/report/get_children', type='jsonrpc', auth='user')
    def get_children(self, report_id, line_id, options):
        report = request.env['account.report'].browse(int(report_id))
        return report.get_report_line_children(int(line_id), options)

    @http.route('/odooer_account/report/get_options', type='jsonrpc', auth='user')
    def get_options(self, report_id, previous_options=None):
        report = request.env['account.report'].browse(int(report_id))
        return report._get_options(previous_options)

    @http.route('/odooer_account/report/get_audit_action', type='jsonrpc', auth='user')
    def get_audit_action(self, report_id, line_id, options, audit_parent_line_id=None, audit_extra_domain=None):
        report = request.env['account.report'].browse(int(report_id))
        return report.get_audit_action(
            line_id,
            options,
            audit_parent_line_id=audit_parent_line_id,
            audit_extra_domain=audit_extra_domain,
        )

    @http.route('/odooer_account/report/export_xlsx', type='http', auth='user')
    def export_xlsx(self, report_id, options):
        report = request.env['account.report'].browse(int(report_id))
        options = json.loads(options)
        content = report.get_xlsx(options)
        filename = (report.name or 'report').replace(' ', '_') + '.xlsx'
        return Response(
            content,
            headers={
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': f'attachment; filename="{filename}"',
            },
        )
