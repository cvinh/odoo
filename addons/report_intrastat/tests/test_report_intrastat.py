# -*- coding: utf-8 -*-

from odoo import tools
from odoo.tests import common
from odoo.modules.module import get_module_resource


class RepoortIntrastatTest(common.TransactionCase):

    def _load(self, module, *args):
        tools.convert_file(self.cr, 'report_intrastat',
                           get_module_resource(module, *args),
                           {}, 'init', False, 'test', self.registry._assertion_report)

    def setUp(self):
        super(RepoortIntrastatTest, self).setUp()

        self._load('account', 'test', 'account_minimal_test.xml')
        self.invoice = self.env['account.invoice'].create({
            'currency_id': self.ref('base.EUR'),
            'company_id': self.ref('base.main_company'),
            'partner_id': self.ref('base.res_partner_1'),
            'state': 'draft',
            'type': 'out_invoice',
            'account_id': self.ref('report_intrastat.a_recv'),
            'name': 'Test invoice 1'
        })

    def test_00_create_pdf(self):
        tools.test_reports.try_report(self.cr, self.uid, 'report_intrastat.report_intrastatinvoice', self.invoice.ids)