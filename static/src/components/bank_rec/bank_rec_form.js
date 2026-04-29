/** @odoo-module **/
import { Component, useState, onWillUpdateProps, onWillStart, useSubEnv } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";
import { useService, useBus } from "@web/core/utils/hooks";
import { SelectCreateDialog } from "@web/views/view_dialogs/select_create_dialog";
import { SearchModel } from "@web/search/search_model";
import { SearchBar } from "@web/search/search_bar/search_bar";
import { Pager } from "@web/core/pager/pager";

export class BankRecForm extends Component {
    static template = "odooer_account.BankRecForm";
    static components = { SearchBar, Pager };
    static props = {
        recData: Object,
        onReconciled: Function,
        onReloadData: Function,
    };

    setup() {
        this.dialog = useService("dialog");

        // Services needed for SearchModel
        const orm = useService("orm");
        const view = useService("view");
        const field = useService("field");
        const name = useService("name");

        this.state = useState({
            // Partner editing
            showPartnerEdit: false,
            partnerSearch: '',
            partnerSuggestions: [],
            partnerLoading: false,
            partnerActiveIndex: -1,  // -1=none; 0..N-1=suggestion; N="Search more..."
            partnerDropdownOpen: false,

            // Pending lines (accumulated before validate)
            pendingLines: [],

            // Add-line panel: null | 'match_entry' | 'set_account'
            addMode: null,

            // Match entry sub-state
            candidates: [],
            candidatesTotal: 0,
            candidatesLoading: false,
            candidateOffset: 0,
            candidateLimit: 15,
            candidateSortField: 'date',
            candidateSortDir: 'desc',
            accountTypeFilter: null,  // null | 'asset_receivable' | 'liability_payable'

            // Set account sub-state
            accountSearch: '',
            accountSuggestions: [],
            accountLoading: false,
            accountActiveIndex: -1,     // -1=none; 0..N-1=suggestion; N="Search more..."
            accountDropdownOpen: false,
            selectedAccount: null,      // {id, name}
            accountAmount: '',
            accountLabel: '',
            accountPartnerSearch: '',
            accountPartnerSuggestions: [],
            accountPartnerActiveIndex: -1, // -1=none; 0..N-1=suggestion; N="Search more..."
            accountPartnerDropdownOpen: false,
            selectedAccountPartner: null, // {id, name}

            // Edit line modal
            editModalOpen: false,
            editModalIndex: -1,
            editModalType: '',      // 'account' | 'aml' | 'server_line'
            editModalAmlAmount: '', // only used for aml type
            editModalLineId: 0,     // server line id for 'server_line' type

            // Transaction edit (left-panel statement line)
            editTransactionMode: false,
            transactionDate: '',
            transactionLabel: '',
            transactionAmount: '',

            // Global
            processing: false,
            error: null,
        });

        this._debounceTimers = {};

        // Native Odoo SearchModel for candidate search
        this._searchModel = new SearchModel(this.env, { orm, view, field, name, dialog: this.dialog });
        useSubEnv({ searchModel: this._searchModel });
        useBus(this._searchModel, "update", () => {
            this.state.candidateOffset = 0;
            this._loadCandidates();
        });
        onWillStart(async () => {
            await this._initSearchModel(this.props.recData);
        });

        onWillUpdateProps(async (nextProps) => {
            // Reset transient UI when switching to another transaction
            this.state.showPartnerEdit = false;
            this.state.partnerSearch = '';
            this.state.partnerSuggestions = [];
            this.state.partnerActiveIndex = -1;
            this.state.partnerDropdownOpen = false;
            this.state.pendingLines = [];
            this.state.addMode = null;
            this.state.candidates = [];
            this.state.candidatesTotal = 0;
            this.state.candidateOffset = 0;
            this.state.candidateSortField = 'date';
            this.state.candidateSortDir = 'desc';
            this.state.accountTypeFilter = null;
            this.state.selectedAccount = null;
            this.state.accountSearch = '';
            this.state.accountSuggestions = [];
            this.state.accountActiveIndex = -1;
            this.state.accountDropdownOpen = false;
            this.state.accountAmount = '';
            this.state.accountLabel = '';
            this.state.selectedAccountPartner = null;
            this.state.accountPartnerSearch = '';
            this.state.accountPartnerSuggestions = [];
            this.state.accountPartnerActiveIndex = -1;
            this.state.accountPartnerDropdownOpen = false;
            this.state.editModalOpen = false;
            this.state.editModalIndex = -1;
            this.state.editModalType = '';
            this.state.editModalAmlAmount = '';
            this.state.editModalLineId = 0;
            this.state.editTransactionMode = false;
            this.state.transactionDate = '';
            this.state.transactionLabel = '';
            this.state.transactionAmount = '';
            // Reload search model if we switched to a different statement line
            if (nextProps.recData.id !== this.props.recData.id) {
                await this._initSearchModel(nextProps.recData);
            }
        });
    }

    // ── SearchModel (native Odoo search for candidates) ──────────────────────

    async _initSearchModel(recData) {
        const arch = `
            <search>
                <field name="name" string="Entry"/>
                <field name="partner_id" string="Partner" operator="child_of"/>
                <field name="account_id" string="Account"/>
            </search>
        `;
        const fields = {
            id: { name: 'id', string: 'ID', type: 'integer', searchable: false },
            name: { name: 'name', string: 'Entry', type: 'char', searchable: true },
            partner_id: { name: 'partner_id', string: 'Partner', type: 'many2one', relation: 'res.partner', searchable: true },
            account_id: { name: 'account_id', string: 'Account', type: 'many2one', relation: 'account.account', searchable: true },
            date: { name: 'date', string: 'Date', type: 'date', searchable: true },
        };
        const dynamicFilters = [];
        if (recData.partner_id) {
            dynamicFilters.push({
                description: recData.partner_name,
                domain: `[('partner_id', '=', ${recData.partner_id})]`,
            });
        }
        await this._searchModel.load({
            resModel: 'account.move.line',
            searchViewArch: arch,
            searchViewFields: fields,
            searchMenuTypes: ['filter'],
            dynamicFilters,
        });
    }

    get recData() {
        return this.props.recData;
    }

    /** Amount of the transaction still unaccounted for by pending lines (always positive) */
    get remainingAmount() {
        const matched = this.state.pendingLines.reduce((s, l) => s + l.amount, 0.0);
        return Math.abs(this.props.recData.amount_residual || 0) - matched;
    }

    get isBalanced() {
        return Math.abs(this.remainingAmount) < 0.005;
    }

    /** Label for what the counterpart lines will be (based on statement direction) */
    get stCounterpartLabel() {
        return (this.recData.amount || 0) >= 0 ? 'Cr' : 'Dr';
    }

    // ── Debounce helper ─────────────────────────────────────────────────────

    _debounce(key, fn, delay = 300) {
        clearTimeout(this._debounceTimers[key]);
        this._debounceTimers[key] = setTimeout(fn, delay);
    }

    // ── Partner ──────────────────────────────────────────────────────────────

    togglePartnerEdit() {
        this.state.showPartnerEdit = !this.state.showPartnerEdit;
        this.state.partnerSearch = '';
        this.state.partnerSuggestions = [];
        this.state.partnerActiveIndex = -1;
    }

    onPartnerSearchInput(ev) {
        this.state.partnerSearch = ev.target.value;
        this.state.partnerActiveIndex = -1;
        this._debounce('partner', () => this._searchPartners(), 300);
    }

    onPartnerKeydown(ev) {
        const suggestions = this.state.partnerSuggestions;
        // Total items = suggestions + "Search more..." (index = suggestions.length)
        const maxIndex = suggestions.length;
        switch (ev.key) {
            case 'ArrowDown':
                ev.preventDefault();
                this.state.partnerActiveIndex = Math.min(this.state.partnerActiveIndex + 1, maxIndex);
                break;
            case 'ArrowUp':
                ev.preventDefault();
                this.state.partnerActiveIndex = Math.max(this.state.partnerActiveIndex - 1, -1);
                break;
            case 'Enter':
                ev.preventDefault();
                if (this.state.partnerActiveIndex === maxIndex) {
                    this.openPartnerSearchDialog();
                } else if (this.state.partnerActiveIndex >= 0) {
                    this.selectPartner(suggestions[this.state.partnerActiveIndex]);
                }
                break;
            case 'Escape':
                ev.preventDefault();
                this.togglePartnerEdit();
                break;
        }
    }

    onPartnerSearchBlur() {
        this.state.partnerSuggestions = [];
        this.state.partnerActiveIndex = -1;
        this.state.partnerDropdownOpen = false;
    }

    onPartnerSearchFocus() {
        this.state.partnerDropdownOpen = true;
    }

    onAccountSearchBlur() {
        this.state.accountSuggestions = [];
        this.state.accountActiveIndex = -1;
        this.state.accountDropdownOpen = false;
    }

    onAccountSearchFocus() {
        this.state.accountDropdownOpen = true;
    }

    onAccountPartnerSearchBlur() {
        this.state.accountPartnerSuggestions = [];
        this.state.accountPartnerActiveIndex = -1;
        this.state.accountPartnerDropdownOpen = false;
    }

    onAccountPartnerSearchFocus() {
        this.state.accountPartnerDropdownOpen = true;
    }

    async _searchPartners() {
        const term = this.state.partnerSearch;
        if (!term || term.length < 2) {
            this.state.partnerSuggestions = [];
            this.state.partnerActiveIndex = -1;
            return;
        }
        this.state.partnerLoading = true;
        try {
            this.state.partnerSuggestions = await rpc('/odooer/bank_rec/search_partners', { term });
            this.state.partnerActiveIndex = -1;
        } finally {
            this.state.partnerLoading = false;
        }
    }

    async selectPartner(partner) {
        this.state.processing = true;
        this.state.error = null;
        try {
            const updated = await rpc('/odooer/bank_rec/update_partner', {
                st_line_id: this.recData.id,
                partner_id: partner.id,
            });
            this.state.showPartnerEdit = false;
            this.state.partnerSuggestions = [];
            // Reload candidates if in match_entry mode (filter may change)
            if (this.state.addMode === 'match_entry') {
                this.state.candidates = [];
            }
            this.props.onReloadData(updated);
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error setting partner';
        }
        this.state.processing = false;
    }

    openPartnerSearchDialog() {
        this.dialog.add(SelectCreateDialog, {
            resModel: 'res.partner',
            title: 'Select a Partner',
            noCreate: false,
            multiSelect: false,
            domain: [['active', '=', true]],
            context: { search_default_name: this.state.partnerSearch || '' },
            onSelected: async (resIds) => {
                if (resIds && resIds.length > 0) {
                    this.state.showPartnerEdit = false;
                    await this.selectPartner({ id: resIds[0] });
                }
            },
        });
    }

    async clearPartner() {
        this.state.processing = true;
        this.state.error = null;
        try {
            const updated = await rpc('/odooer/bank_rec/update_partner', {
                st_line_id: this.recData.id,
                partner_id: false,
            });
            this.state.showPartnerEdit = false;
            this.props.onReloadData(updated);
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error clearing partner';
        }
        this.state.processing = false;
    }

    // ── AR / AP quick-add ────────────────────────────────────────────────────

    async addArApLine(accountType) {
        this.state.error = null;
        if (!this.recData.partner_id) {
            this.state.error = 'Please set a partner before adding a Receivable or Payable line.';
            return;
        }
        try {
            const account = await rpc('/odooer/bank_rec/get_ar_ap_account', {
                partner_id: this.recData.partner_id,
                account_type: accountType,
            });
            if (!account) {
                this.state.error = 'No AR/AP account configured for this partner';
                return;
            }
            const remaining = this.remainingAmount;
            if (Math.abs(remaining) < 0.005) {
                this.state.error = 'Transaction is already fully matched';
                return;
            }
            const label = accountType === 'asset_receivable' ? 'Receivable' : 'Payable';
            this.state.pendingLines.push({
                type: 'account',
                account_id: account.id,
                account_name: account.name,
                partner_id: this.recData.partner_id,
                partner_name: this.recData.partner_name,
                label: this.recData.payment_ref || label,
                amount: Math.abs(remaining),
            });
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error loading AR/AP account';
        }
    }

    // ── Match existing entry ─────────────────────────────────────────────────

    setAddMode(mode) {
        // Toggle off — always allowed
        if (this.state.addMode === mode) {
            this.state.addMode = null;
            this.state.error = null;
            return;
        }
        if (this.isBalanced) {
            this.state.error = 'Transaction is already fully matched';
            return;
        }
        // Switching away from another mode — just set
        this.state.addMode = mode;
        this.state.error = null;
        this.state.accountTypeFilter = null;
        if (mode === 'match_entry' && this.state.candidates.length === 0) {
            this._loadCandidates();
        }
        if (mode === 'set_account') {
            // Pre-fill amount as absolute value (sign determined by statement direction on server)
            this.state.accountAmount = Math.abs(this.remainingAmount).toFixed(2);
            // Pre-fill label from payment ref
            this.state.accountLabel = this.recData.payment_ref || '';
            // Pre-fill partner from the transaction's partner
            if (this.recData.partner_id && !this.state.selectedAccountPartner) {
                this.state.selectedAccountPartner = {
                    id: this.recData.partner_id,
                    name: this.recData.partner_name,
                };
                this.state.accountPartnerSearch = this.recData.partner_name || '';
            }
        }
    }

    setLiquidityTransferMode() {
        // Toggle the info panel; actual swap happens in applyLiquidityTransfer
        if (this.state.addMode === 'liquidity_transfer') {
            this.state.addMode = null;
            this.state.error = null;
        } else {
            this.state.addMode = 'liquidity_transfer';
            this.state.error = null;
        }
    }

    async applyLiquidityTransfer() {
        this.state.processing = true;
        this.state.error = null;
        try {
            const result = await rpc('/odooer/bank_rec/apply_liquidity_transfer', {
                st_line_id: this.props.recData.id,
            });
            if (result.error) {
                this.state.error = result.error;
            } else {
                this.state.addMode = null;
                this.props.onReconciled(result);
            }
        } catch (e) {
            this.state.error = e.message || 'Failed to apply liquidity transfer';
        } finally {
            this.state.processing = false;
        }
    }

    setAccountTypeFilter(type) {
        this.state.accountTypeFilter = this.state.accountTypeFilter === type ? null : type;
        this.state.candidateOffset = 0;
        this._loadCandidates();
    }

    sortCandidates(field) {
        if (this.state.candidateSortField === field) {
            this.state.candidateSortDir = this.state.candidateSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.candidateSortField = field;
            this.state.candidateSortDir = field === 'amount' ? 'desc' : 'asc';
        }
        this.state.candidateOffset = 0;
        this._loadCandidates();
    }

    onCandidatePagerUpdate({ offset }) {
        this.state.candidateOffset = offset;
        this._loadCandidates();
    }

    async _loadCandidates() {
        if (this.state.addMode !== 'match_entry') return;
        this.state.candidatesLoading = true;
        try {
            const result = await rpc('/odooer/bank_rec/get_candidates', {
                st_line_id: this.recData.id,
                account_type: this.state.accountTypeFilter || null,
                extra_domain: this._searchModel.domain,
                sort_field: this.state.candidateSortField,
                sort_dir: this.state.candidateSortDir,
                offset: this.state.candidateOffset,
                limit: this.state.candidateLimit,
            });
            this.state.candidates = result.records;
            this.state.candidatesTotal = result.total;
        } finally {
            this.state.candidatesLoading = false;
        }
    }

    addAmlLine(candidate) {
        if (this.state.pendingLines.some(l => l.type === 'aml' && l.aml_id === candidate.id)) {
            this.state.error = 'This entry is already in the list';
            return;
        }
        const remaining = this.remainingAmount;
        if (Math.abs(remaining) < 0.005) {
            this.state.error = 'Transaction is already fully matched';
            return;
        }
        // Cap at remaining unmatched amount; always store as positive (abs value)
        const amount = Math.min(Math.abs(candidate.amount_residual), Math.abs(remaining));
        this.state.pendingLines.push({
            type: 'aml',
            aml_id: candidate.id,
            account_name: candidate.account_display,
            partner_name: candidate.partner_name,
            label: candidate.move_name,
            amount,
        });
        this.state.error = null;
    }

    // ── Set account directly ─────────────────────────────────────────────────

    onAccountSearchInput(ev) {
        this.state.accountSearch = ev.target.value;
        this.state.selectedAccount = null;
        this.state.accountActiveIndex = -1;
        this._debounce('accounts', () => this._searchAccounts(), 300);
    }

    onAccountKeydown(ev) {
        const suggestions = this.state.accountSuggestions;
        const maxIndex = suggestions.length; // "Search more..." at maxIndex
        switch (ev.key) {
            case 'ArrowDown':
                ev.preventDefault();
                this.state.accountActiveIndex = Math.min(this.state.accountActiveIndex + 1, maxIndex);
                break;
            case 'ArrowUp':
                ev.preventDefault();
                this.state.accountActiveIndex = Math.max(this.state.accountActiveIndex - 1, -1);
                break;
            case 'Enter':
                ev.preventDefault();
                if (this.state.accountActiveIndex === maxIndex) {
                    this.openAccountSearchDialog();
                } else if (this.state.accountActiveIndex >= 0) {
                    this.selectAccount(suggestions[this.state.accountActiveIndex]);
                }
                break;
            case 'Escape':
                ev.preventDefault();
                this.state.accountSearch = '';
                this.state.accountSuggestions = [];
                this.state.accountActiveIndex = -1;
                this.state.selectedAccount = null;
                break;
        }
    }

    openAccountSearchDialog() {
        this.dialog.add(SelectCreateDialog, {
            resModel: 'account.account',
            title: 'Select Account',
            noCreate: true,
            multiSelect: false,
            domain: [['active', '=', true], ['account_type', 'not in', ['off_balance']]],
            context: { search_default_name: this.state.accountSearch || '' },
            onSelected: async (resIds) => {
                if (resIds && resIds.length > 0) {
                    const accounts = await rpc('/odooer/bank_rec/get_accounts_by_ids', { ids: resIds });
                    if (accounts && accounts.length > 0) {
                        this.selectAccount(accounts[0]);
                    }
                }
            },
        });
    }

    async _searchAccounts() {
        const term = this.state.accountSearch;
        if (!term || term.length < 2) {
            this.state.accountSuggestions = [];
            return;
        }
        this.state.accountLoading = true;
        try {
            this.state.accountSuggestions = await rpc('/odooer/bank_rec/search_accounts', { term });
            this.state.accountActiveIndex = -1;
        } finally {
            this.state.accountLoading = false;
        }
    }

    selectAccount(account) {
        this.state.selectedAccount = account;
        this.state.accountSearch = account.name;
        this.state.accountSuggestions = [];
        this.state.accountActiveIndex = -1;
    }

    onAccountAmountInput(ev) {
        this.state.accountAmount = ev.target.value;
    }

    onAccountLabelInput(ev) {
        this.state.accountLabel = ev.target.value;
    }

    onAccountPartnerSearchInput(ev) {
        this.state.accountPartnerSearch = ev.target.value;
        this.state.selectedAccountPartner = null;
        this.state.accountPartnerActiveIndex = -1;
        this._debounce('acct_partner', () => this._searchAccountPartner(), 300);
    }

    onAccountPartnerKeydown(ev) {
        const suggestions = this.state.accountPartnerSuggestions;
        const maxIndex = suggestions.length; // "Search more..." at maxIndex
        switch (ev.key) {
            case 'ArrowDown':
                ev.preventDefault();
                this.state.accountPartnerActiveIndex = Math.min(this.state.accountPartnerActiveIndex + 1, maxIndex);
                break;
            case 'ArrowUp':
                ev.preventDefault();
                this.state.accountPartnerActiveIndex = Math.max(this.state.accountPartnerActiveIndex - 1, -1);
                break;
            case 'Enter':
                ev.preventDefault();
                if (this.state.accountPartnerActiveIndex === maxIndex) {
                    this.openAccountPartnerSearchDialog();
                } else if (this.state.accountPartnerActiveIndex >= 0) {
                    this.selectAccountPartner(suggestions[this.state.accountPartnerActiveIndex]);
                }
                break;
            case 'Escape':
                ev.preventDefault();
                this.state.accountPartnerSearch = '';
                this.state.accountPartnerSuggestions = [];
                this.state.accountPartnerActiveIndex = -1;
                this.state.selectedAccountPartner = null;
                break;
        }
    }

    openAccountPartnerSearchDialog() {
        this.dialog.add(SelectCreateDialog, {
            resModel: 'res.partner',
            title: 'Select Partner',
            noCreate: false,
            multiSelect: false,
            domain: [['active', '=', true]],
            context: { search_default_name: this.state.accountPartnerSearch || '' },
            onSelected: async (resIds) => {
                if (resIds && resIds.length > 0) {
                    const partners = await rpc('/odooer/bank_rec/get_partners_by_ids', { ids: resIds });
                    if (partners && partners.length > 0) {
                        this.selectAccountPartner(partners[0]);
                    }
                }
            },
        });
    }

    async _searchAccountPartner() {
        const term = this.state.accountPartnerSearch;
        if (!term || term.length < 2) {
            this.state.accountPartnerSuggestions = [];
            return;
        }
        const results = await rpc('/odooer/bank_rec/search_partners', { term });
        this.state.accountPartnerSuggestions = results;
        this.state.accountPartnerActiveIndex = -1;
    }

    selectAccountPartner(partner) {
        this.state.selectedAccountPartner = partner;
        this.state.accountPartnerSearch = partner.name;
        this.state.accountPartnerSuggestions = [];
        this.state.accountPartnerActiveIndex = -1;
    }

    addAccountLine() {
        if (this.isBalanced) {
            this.state.error = 'Transaction is already fully matched';
            return;
        }
        if (!this.state.selectedAccount) {
            this.state.error = 'Please select an account';
            return;
        }
        const amount = Math.abs(parseFloat(this.state.accountAmount));
        if (!amount || isNaN(amount) || amount <= 0) {
            this.state.error = 'Please enter a valid positive amount';
            return;
        }
        this.state.pendingLines.push({
            type: 'account',
            account_id: this.state.selectedAccount.id,
            account_name: this.state.selectedAccount.name,
            partner_id: this.state.selectedAccountPartner?.id || this.recData.partner_id || null,
            partner_name: this.state.selectedAccountPartner?.name || this.recData.partner_name || '',
            label: this.state.accountLabel || this.recData.payment_ref || '',
            amount,
        });
        // Reset account form
        this.state.selectedAccount = null;
        this.state.accountSearch = '';
        this.state.accountAmount = '';
        this.state.accountLabel = '';
        this.state.selectedAccountPartner = null;
        this.state.accountPartnerSearch = '';
        this.state.addMode = null;
        this.state.error = null;
    }

    // ── Pending lines management ─────────────────────────────────────────────

    removePendingLine(idx) {
        this.state.pendingLines.splice(idx, 1);
        this.state.error = null;
    }

    openEditLine(idx) {
        const pl = this.state.pendingLines[idx];
        this.state.editModalIndex = idx;
        this.state.editModalType = pl.type;
        this.state.addMode = null;  // close any open panel
        if (pl.type === 'aml') {
            this.state.editModalAmlAmount = String(Math.abs(pl.amount));
        } else {
            // Pre-fill Set Account state for reuse
            this.state.selectedAccount = pl.account_id ? { id: pl.account_id, name: pl.account_name } : null;
            this.state.accountSearch = pl.account_name || '';
            this.state.accountAmount = String(Math.abs(pl.amount));  // always positive
            this.state.accountLabel = pl.label || '';
            this.state.selectedAccountPartner = pl.partner_id ? { id: pl.partner_id, name: pl.partner_name } : null;
            this.state.accountPartnerSearch = pl.partner_name || '';
        }
        this.state.editModalOpen = true;
        this.state.error = null;
    }

    closeEditModal() {
        this.state.editModalOpen = false;
        this.state.editModalIndex = -1;
        this.state.editModalType = '';
        this.state.editModalAmlAmount = '';
        this.state.editModalLineId = 0;
        this.state.selectedAccount = null;
        this.state.accountSearch = '';
        this.state.accountSuggestions = [];
        this.state.accountAmount = '';
        this.state.accountLabel = '';
        this.state.selectedAccountPartner = null;
        this.state.accountPartnerSearch = '';
        this.state.accountPartnerSuggestions = [];
    }

    confirmEditLine() {
        if (this.state.editModalType === 'server_line') {
            this._confirmEditServerLine();
            return;
        }
        const idx = this.state.editModalIndex;
        if (idx < 0 || idx >= this.state.pendingLines.length) return;
        const pl = this.state.pendingLines[idx];

        if (this.state.editModalType === 'aml') {
            const absAmount = parseFloat(this.state.editModalAmlAmount);
            if (!absAmount || isNaN(absAmount) || absAmount <= 0) {
                this.state.error = 'Please enter a valid amount';
                return;
            }
            pl.amount = absAmount;  // always stored as absolute value
        } else {
            if (!this.state.selectedAccount) {
                this.state.error = 'Please select an account';
                return;
            }
            const amount = Math.abs(parseFloat(this.state.accountAmount));
            if (!amount || isNaN(amount)) {
                this.state.error = 'Please enter a valid amount';
                return;
            }
            pl.account_id = this.state.selectedAccount.id;
            pl.account_name = this.state.selectedAccount.name;
            pl.partner_id = this.state.selectedAccountPartner?.id || null;
            pl.partner_name = this.state.selectedAccountPartner?.name || '';
            pl.label = this.state.accountLabel || '';
            pl.amount = amount;  // absolute value
        }
        this.closeEditModal();
    }

    // ── Matched entry edit/delete (right-panel server lines) ────────────────

    openEditServerLine(ml) {
        this.state.addMode = null;
        this.state.editModalLineId = ml.id;
        this.state.editModalType = 'server_line';
        this.state.accountLabel = ml.label || '';
        this.state.accountAmount = String(Math.abs(ml.balance));
        this.state.editModalOpen = true;
        this.state.error = null;
    }

    async deleteServerLine(lineId) {
        if (this.state.processing) return;
        if (!confirm('Remove this matched entry line?')) return;
        this.state.processing = true;
        this.state.error = null;
        try {
            const result = await rpc('/odooer/bank_rec/delete_matched_line', {
                st_line_id: this.recData.id,
                line_id: lineId,
            });
            if (result.error) {
                this.state.error = result.error;
            } else {
                this.props.onReloadData(result);
            }
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error deleting line';
        } finally {
            this.state.processing = false;
        }
    }

    async _confirmEditServerLine() {
        const lineId = this.state.editModalLineId;
        const label = this.state.accountLabel || '';
        const isMatched = this.recData.is_reconciled;
        if (!isMatched) {
            const amount = parseFloat(this.state.accountAmount);
            if (isNaN(amount) || amount === 0) {
                this.state.error = 'Please enter a valid amount';
                return;
            }
        }
        this.closeEditModal();
        this.state.processing = true;
        this.state.error = null;
        try {
            const result = await rpc('/odooer/bank_rec/edit_matched_line', {
                st_line_id: this.recData.id,
                line_id: lineId,
                label: label,
                amount: isMatched ? null : parseFloat(this.state.accountAmount || '0'),
            });
            if (result.error) {
                this.state.error = result.error;
            } else {
                this.props.onReloadData(result);
            }
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error saving line';
        } finally {
            this.state.processing = false;
        }
    }

    // ── Transaction edit/delete (left-panel statement line) ─────────────────

    toggleTransactionEdit() {
        this.state.editTransactionMode = true;
        this.state.transactionDate = this.recData.date || '';
        this.state.transactionLabel = this.recData.payment_ref || '';
        this.state.transactionAmount = String(this.recData.amount || '');
    }

    cancelTransactionEdit() {
        this.state.editTransactionMode = false;
    }

    async saveTransactionEdit() {
        if (this.state.processing) return;
        this.state.processing = true;
        this.state.error = null;
        try {
            const result = await rpc('/odooer/bank_rec/edit_statement_line', {
                st_line_id: this.recData.id,
                date: this.state.transactionDate,
                payment_ref: this.state.transactionLabel,
                amount: parseFloat(this.state.transactionAmount) || 0,
            });
            if (result.error) {
                this.state.error = result.error;
            } else {
                this.state.editTransactionMode = false;
                this.props.onReloadData(result);
            }
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error saving';
        } finally {
            this.state.processing = false;
        }
    }

    async deleteStatementLine() {
        if (this.state.processing) return;
        if (!confirm('Delete this bank statement line? This cannot be undone.')) return;
        this.state.processing = true;
        this.state.error = null;
        try {
            const result = await rpc('/odooer/bank_rec/delete_statement_line', {
                st_line_id: this.recData.id,
            });
            if (result && result.error) {
                this.state.error = result.error;
                this.state.processing = false;
            } else {
                this.props.onReconciled();
            }
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error deleting';
            this.state.processing = false;
        }
    }

    // ── Validate / Unmatch ───────────────────────────────────────────────────

    async validateAll() {
        this.state.processing = true;
        this.state.error = null;
        try {
            const lines = this.state.pendingLines.map(l => ({
                type: l.type === 'aml' ? 'aml' : 'account',
                aml_id: l.aml_id || null,
                account_id: l.account_id || null,
                partner_id: l.partner_id || null,
                label: l.label || '',
                amount: l.amount,
            }));
            const result = await rpc('/odooer/bank_rec/validate_lines', {
                st_line_id: this.recData.id,
                pending_lines: lines,
            });
            if (result.error) {
                this.state.error = result.error;
            } else {
                this.props.onReconciled();
            }
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error during reconciliation';
        }
        this.state.processing = false;
    }

    async unmatch() {
        this.state.processing = true;
        this.state.error = null;
        try {
            await rpc('/odooer/bank_rec/unmatch', { st_line_id: this.recData.id });
            this.state.pendingLines = [];
            this.props.onReloadData();
        } catch (e) {
            this.state.error = e.data?.message || e.message || 'Error undoing reconciliation';
        }
        this.state.processing = false;
    }

    openJournalEntry() {
        const moveId = this.recData.move_id;
        if (!moveId) return;
        window.open(`/web#id=${moveId}&model=account.move&view_type=form`, '_blank');
    }
}
