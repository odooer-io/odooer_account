# License: LGPL-3
{
    'name': 'Odooer Accounting',
    'version': '19.0.1.0.0',
    'category': 'Accounting/Accounting',
    'summary': 'Advanced accounting features for Odoo 19 Community Edition',
    'description': """
        Extends the Odoo 19 CE accounting module with enterprise-inspired features:
        - Interactive financial report engine (load-on-demand, drill-down, groupby)
        - P&L and Balance Sheet reports
        - Bank statement import (CSV / XLSX)
        - Bank reconciliation UI widget
        - Fiscal lock dates
    """,
    'author': 'Odooer.io',
    'website': 'https://odooer.io',
    'license': 'LGPL-3',
    'depends': ['account', 'web'],
    'data': [
        'security/odooer_account_security.xml',
        'security/ir.model.access.csv',
        'data/reports/profit_and_loss.xml',
        'data/reports/balance_sheet.xml',
        'data/reports/trial_balance.xml',
        'data/reports/general_ledger.xml',
        'data/reports/partner_ledger.xml',
        'data/reports/aged_receivable.xml',
        'data/reports/aged_payable.xml',
        'views/account_report_views.xml',
        'views/account_bank_statement_views.xml',
        'views/account_reconcile_views.xml',
        'views/res_config_settings_views.xml',
        'views/account_bank_rec_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'odooer_account/static/src/components/account_report/account_report.scss',
            'odooer_account/static/src/components/account_report/controller.js',
            'odooer_account/static/src/components/account_report/account_report.js',
            'odooer_account/static/src/components/account_report/account_report.xml',
            'odooer_account/static/src/components/account_report/line/line.js',
            'odooer_account/static/src/components/account_report/line/line.xml',
            'odooer_account/static/src/components/account_report/line_cell/line_cell.js',
            'odooer_account/static/src/components/account_report/line_cell/line_cell.xml',
            'odooer_account/static/src/components/account_report/filters/filters.js',
            'odooer_account/static/src/components/account_report/filters/filters.xml',
            'odooer_account/static/src/components/account_report/buttons_bar/buttons_bar.js',
            'odooer_account/static/src/components/account_report/buttons_bar/buttons_bar.xml',
            'odooer_account/static/src/components/bank_rec/bank_rec_widget.scss',
            'odooer_account/static/src/components/bank_rec/bank_rec_widget.js',
            'odooer_account/static/src/components/bank_rec/bank_rec_widget.xml',
            'odooer_account/static/src/components/bank_rec/bank_rec_transaction_list.js',
            'odooer_account/static/src/components/bank_rec/bank_rec_transaction_list.xml',
            'odooer_account/static/src/components/bank_rec/bank_rec_form.js',
            'odooer_account/static/src/components/bank_rec/bank_rec_form.xml',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}
