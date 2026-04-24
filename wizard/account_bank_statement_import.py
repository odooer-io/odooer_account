# License: LGPL-3
import base64
import csv
import io
import logging

from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)


class AccountBankStatementImport(models.TransientModel):
    """Wizard to import bank statement lines from CSV or XLSX files."""

    _name = 'odooer.account.bank.statement.import'
    _description = 'Bank Statement Import'

    journal_id = fields.Many2one(
        'account.journal',
        string='Bank Journal',
        required=True,
        domain=[('type', 'in', ['bank', 'cash'])],
        default=lambda self: self._default_journal(),
    )
    attachment = fields.Binary(string='File', required=True, attachment=False)
    attachment_name = fields.Char(string='Filename')
    file_type = fields.Selection(
        [('csv', 'CSV'), ('xlsx', 'Excel (.xlsx)')],
        string='File Type',
        compute='_compute_file_type',
        store=False,
    )

    # Column mapping
    col_date = fields.Char(string='Date Column', default='Date')
    col_description = fields.Char(string='Description Column', default='Description')
    col_amount = fields.Char(string='Amount Column', default='Amount')
    col_debit = fields.Char(string='Debit Column', default='Debit')
    col_credit = fields.Char(string='Credit Column', default='Credit')
    col_balance = fields.Char(string='Cumulative Balance Column', default='Balance')
    col_ref = fields.Char(string='Reference Column', default='Reference')

    date_format = fields.Char(
        string='Date Format',
        default='%Y-%m-%d',
        help='Python strptime format, e.g. %d/%m/%Y or %Y-%m-%d',
    )
    decimal_separator = fields.Selection(
        [('.', 'Dot (1,000.00)'), (',', 'Comma (1.000,00)')],
        string='Decimal Separator',
        default='.',
    )

    def _default_journal(self):
        return self.env['account.journal'].search([('type', '=', 'bank')], limit=1)

    @api.depends('attachment_name')
    def _compute_file_type(self):
        for rec in self:
            name = (rec.attachment_name or '').lower()
            if name.endswith('.xlsx'):
                rec.file_type = 'xlsx'
            else:
                rec.file_type = 'csv'

    # -------------------------------------------------------------------------
    # Import entry point
    # -------------------------------------------------------------------------

    def action_import(self):
        self.ensure_one()
        if not self.attachment:
            raise UserError(_('Please upload a file.'))

        raw = base64.b64decode(self.attachment)

        if (self.attachment_name or '').lower().endswith('.xlsx'):
            rows, headers = self._parse_xlsx(raw)
        else:
            rows, headers = self._parse_csv(raw)

        lines = self._map_rows_to_statement_lines(rows, headers)
        if not lines:
            raise UserError(_('No valid transaction rows found in the file.'))

        statement = self._create_or_update_statement(lines)
        return {
            'type': 'ir.actions.act_window',
            'name': _('Bank Statement'),
            'res_model': 'account.bank.statement',
            'res_id': statement.id,
            'view_mode': 'form',
        }

    # -------------------------------------------------------------------------
    # Parsers
    # -------------------------------------------------------------------------

    def _parse_csv(self, raw_bytes):
        """Parse CSV bytes; returns (rows, headers)."""
        encoding = 'utf-8-sig'  # handles BOM
        try:
            text = raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            text = raw_bytes.decode('latin-1')

        reader = csv.DictReader(io.StringIO(text))
        headers = reader.fieldnames or []
        rows = list(reader)
        return rows, headers

    def _parse_xlsx(self, raw_bytes):
        """Parse XLSX bytes; returns (rows, headers)."""
        try:
            import openpyxl
        except ImportError:
            raise UserError(_('Please install openpyxl to import Excel files.'))

        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True)
        ws = wb.active

        all_rows = list(ws.iter_rows(values_only=True))
        if not all_rows:
            return [], []

        headers = [str(h).strip() if h is not None else '' for h in all_rows[0]]
        rows = []
        for raw_row in all_rows[1:]:
            row_dict = {headers[i]: (raw_row[i] if i < len(raw_row) else None) for i in range(len(headers))}
            rows.append(row_dict)
        return rows, headers

    # -------------------------------------------------------------------------
    # Row mapping
    # -------------------------------------------------------------------------

    def _map_rows_to_statement_lines(self, rows, headers):
        """Convert raw rows into a list of account.bank.statement.line value dicts."""
        lines = []
        running_balance = None

        for i, row in enumerate(rows):
            date = self._get_date(row, i)
            if date is None:
                continue

            amount = self._get_amount(row, i)
            if amount is None:
                continue

            balance = self._get_balance(row)
            if balance is not None:
                running_balance = balance

            lines.append({
                'date': date,
                'payment_ref': self._get_col(row, self.col_description) or '',
                'ref': self._get_col(row, self.col_ref) or '',
                'amount': amount,
                'running_balance': running_balance,
            })

        return lines

    def _get_col(self, row, col_name):
        """Return stripped cell value or None."""
        val = row.get(col_name)
        if val is None:
            return None
        return str(val).strip() or None

    def _get_date(self, row, row_idx):
        """Parse date cell. Returns a date object or None."""
        raw = self._get_col(row, self.col_date)
        if not raw:
            return None
        # openpyxl may already parse dates
        if isinstance(raw, (fields.Date, type(fields.Date.today()))):
            return raw
        try:
            import datetime
            return datetime.datetime.strptime(raw, self.date_format).date()
        except ValueError:
            _logger.warning('Row %d: cannot parse date %r with format %s', row_idx + 2, raw, self.date_format)
            return None

    def _get_amount(self, row, row_idx):
        """Derive transaction amount. Supports amount, or debit/credit columns."""
        raw_amount = self._get_col(row, self.col_amount)
        raw_debit = self._get_col(row, self.col_debit)
        raw_credit = self._get_col(row, self.col_credit)

        def _parse_float(s):
            if s is None:
                return None
            if isinstance(s, (int, float)):
                return float(s)
            s = s.strip().replace(' ', '').replace('\u00a0', '')
            if self.decimal_separator == ',':
                s = s.replace('.', '').replace(',', '.')
            else:
                s = s.replace(',', '')
            try:
                return float(s)
            except ValueError:
                return None

        if raw_amount is not None:
            return _parse_float(raw_amount)

        debit = _parse_float(raw_debit) or 0.0
        credit = _parse_float(raw_credit) or 0.0
        if debit or credit:
            return debit - credit

        _logger.warning('Row %d: no amount found', row_idx + 2)
        return None

    def _get_balance(self, row):
        """Parse optional cumulative balance column."""
        raw = self._get_col(row, self.col_balance)
        if raw is None:
            return None
        if isinstance(raw, (int, float)):
            return float(raw)
        s = str(raw).strip().replace(',', '')
        try:
            return float(s)
        except ValueError:
            return None

    # -------------------------------------------------------------------------
    # Statement creation
    # -------------------------------------------------------------------------

    def _create_or_update_statement(self, lines):
        """Create an account.bank.statement with the parsed lines."""
        statement_vals = {
            'journal_id': self.journal_id.id,
            'name': _('Import %s', fields.Date.context_today(self)),
            'line_ids': [],
        }
        for line in lines:
            statement_vals['line_ids'].append((0, 0, {
                'date': line['date'],
                'payment_ref': line['payment_ref'],
                'ref': line['ref'],
                'amount': line['amount'],
                'journal_id': self.journal_id.id,
            }))

        return self.env['account.bank.statement'].create(statement_vals)
