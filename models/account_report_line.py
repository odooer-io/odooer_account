from odoo import api, fields, models


class AccountReportLine(models.Model):
    _inherit = 'account.report.line'

    depth = fields.Integer(
        string='Depth',
        compute='_compute_depth',
        recursive=True,
        store=True,
    )

    name_indented = fields.Char(
        string='Name',
        compute='_compute_name_indented',
        recursive=True,
    )

    has_children = fields.Boolean(
        string='Has Children',
        compute='_compute_has_children',
        store=True,
    )

    @api.depends('parent_id', 'parent_id.depth')
    def _compute_depth(self):
        for line in self:
            line.depth = (line.parent_id.depth + 1) if line.parent_id else 0

    @api.depends('name', 'depth')
    def _compute_name_indented(self):
        # Use non-breaking spaces (\u00a0) — regular spaces collapse in HTML
        nb = '\u00a0'
        prefixes = [
            '',                    # depth 0: top section
            f'\u00b7 ',            # depth 1: · name
            f'{nb*2}\u00b7 ',      # depth 2: ··name
            f'{nb*4}\u00b7 ',      # depth 3:     · name
            f'{nb*6}\u00b7 ',      # depth 4:       · name
        ]
        for line in self:
            idx = min(line.depth, len(prefixes) - 1)
            line.name_indented = prefixes[idx] + (line.name or '')

    @api.depends('children_ids')
    def _compute_has_children(self):
        for line in self:
            line.has_children = bool(line.children_ids)
