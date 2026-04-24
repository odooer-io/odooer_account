# License: LGPL-3
from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    fiscalyear_last_day = fields.Integer(
        related='company_id.fiscalyear_last_day',
        readonly=False,
        string="Fiscal Year Last Day",
    )
    fiscalyear_last_month = fields.Selection(
        related='company_id.fiscalyear_last_month',
        readonly=False,
        string="Fiscal Year Last Month",
    )
