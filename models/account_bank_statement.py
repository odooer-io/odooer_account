# License: LGPL-3
from odoo import models, fields


class AccountBankStatement(models.Model):
    """Thin extension — placeholder for future statement-level helpers."""
    _inherit = 'account.bank.statement'


class AccountBankStatementLine(models.Model):
    """Thin extension — placeholder for import helpers."""
    _inherit = 'account.bank.statement.line'
