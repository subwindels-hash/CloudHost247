"""The account pages are first-party templates, so their contract belongs to this repository.

Log-in, registration and password recovery used to arrive from the Twenty-One parent. They are
now shipped by `templates/cloudhost247`, which means the form contract WHMCS posts to is
maintained here and nothing but a test stops an edit from dropping a field, renaming an id the
vendor JavaScript looks up, or pointing a reset step at a route the platform does not answer.

The assertions are deliberately about the *contract*, not the markup: field names and ids, the
route a form posts to, the hidden flags the server reads, and the scripts the page must load.
A designer can restyle these pages freely; a rename that would break checkout fails here.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
THEME = ROOT / 'templates' / 'cloudhost247'


def read(name: str) -> str:
    path = THEME / name
    if not path.is_file():
        raise AssertionError(f'{name} is not shipped by the theme')
    return path.read_text()


def strip_comments(text: str) -> str:
    return re.sub(r'\{%.*?%\}', '', text, flags=re.S)


class LoginPageTests(unittest.TestCase):
    def setUp(self):
        self.template = read('login.tpl')

    def test_posts_to_the_platform_login_route(self):
        self.assertIn("{routePath('login-validate')}", self.template)
        self.assertIn('method="post"', self.template)

    def test_keeps_the_field_names_the_platform_reads(self):
        for field in ('username', 'password'):
            self.assertRegex(self.template, rf'name="{field}"', f'the login form lost {field}')
        self.assertRegex(self.template, r'id="inputEmail"')
        self.assertRegex(self.template, r'id="inputPassword"')
        self.assertIn('name="rememberme"', self.template)

    def test_keeps_the_captcha_partial_and_its_button_class(self):
        self.assertIn('$template/includes/captcha.tpl', self.template)
        self.assertIn('getButtonClass($captchaForm)', self.template,
                      'an invisible captcha attaches itself through the submit button class')

    def test_every_visible_field_is_labelled_from_the_language_pack(self):
        labels = re.findall(r'<label[^>]*>([^<]*)</label>', self.template)
        self.assertGreaterEqual(len(labels), 2)
        for label in labels:
            text = label.strip()
            if not text:
                continue
            # Either the WHMCS language array or the Smarty `lang` function is acceptable;
            # a literal English label is not, because it cannot be translated.
            self.assertTrue('$LANG' in text or '{lang' in text,
                            f'hardcoded label text: {label!r}')


class RegistrationPageTests(unittest.TestCase):
    def setUp(self):
        self.template = read('clientregister.tpl')

    def test_posts_back_to_itself_with_the_register_flag(self):
        self.assertIn('id="frmCheckout"', self.template)
        self.assertIn('action="{$smarty.server.PHP_SELF}"', self.template)
        self.assertRegex(self.template, r'name="register"\s+value="true"')

    def test_every_field_the_registration_handler_reads_is_present(self):
        # Names are the platform's; the order and grouping are the theme's.
        for field in ('firstname', 'lastname', 'companyname', 'email', 'phonenumber', 'address1',
                      'address2', 'city', 'state', 'postcode', 'country', 'password', 'password2',
                      'securityqid', 'securityqans', 'tax_id', 'currency', 'marketingoptin',
                      'accepttos'):
            self.assertRegex(self.template, rf'name="{field}"', f'the registration form lost {field}')

    def test_keeps_the_ids_the_vendor_javascript_looks_up(self):
        for element_id in ('inputFirstName', 'inputLastName', 'inputEmail', 'inputCity', 'state',
                           'inputPostcode', 'inputCountry', 'inputNewPassword1', 'inputNewPassword2',
                           'registerbtn'):
            self.assertRegex(self.template, rf'id="{element_id}"', f'the registration form lost #{element_id}')

    def test_loads_the_state_and_password_scripts(self):
        self.assertIn('StatesDropdown.js', self.template)
        self.assertIn('PasswordStrength.js', self.template)
        for constant in ('langPasswordWeak', 'langPasswordModerate', 'langPasswordStrong'):
            self.assertIn(constant, self.template)

    def test_the_platform_validation_hook_cannot_block_a_valid_submission(self):
        # The helper is a WHMCS global. If it is absent the browser's required attributes and the
        # server's own validation still apply; an unguarded call would throw and cancel the submit.
        self.assertRegex(self.template, r"typeof registerForm === 'function'\s*\?\s*registerForm\(\)\s*:\s*true")

    def test_the_theme_never_disables_the_submit_button_from_inline_script(self):
        self.assertNotIn("attr('disabled'", self.template)
        self.assertNotIn('attr("disabled"', self.template)

    def test_required_attributes_follow_the_platform_optional_fields(self):
        # A field the platform marks optional must not be `required` here, and vice versa: the
        # browser check and the server check have to agree about the same field.
        self.assertRegex(self.template, r"in_array\('firstname', \$optionalFields\)")
        self.assertRegex(self.template, r"in_array\('postcode', \$optionalFields\)")

    def test_captcha_and_terms_are_rendered_when_the_platform_supplies_them(self):
        self.assertIn('$template/includes/captcha.tpl', self.template)
        self.assertIn('{if $accepttos}', self.template)


class PasswordRecoveryTests(unittest.TestCase):
    def test_the_container_hands_off_to_the_step_the_platform_names(self):
        container = read('password-reset-container.tpl')
        self.assertIn('{include file="$template/password-reset-$innerTemplate.tpl"}', container)

    def test_every_step_the_container_can_render_exists_and_is_not_empty(self):
        for step in ('email', 'security', 'change'):
            path = THEME / f'password-reset-{step}-prompt.tpl'
            self.assertTrue(path.is_file(), f'the {step} step is missing')
            self.assertGreater(len(path.read_text().strip()), 200, f'the {step} step is a stub')

    def test_each_step_posts_to_the_route_that_answers_it(self):
        expected = {
            'password-reset-email-prompt.tpl': ("routePath('password-reset-validate-email')", 'name="action"'),
            'password-reset-security-prompt.tpl': ("routePath('password-reset-security-verify')", 'name="answer"'),
            'password-reset-change-prompt.tpl': ("routePath('password-reset-change-perform')", 'name="answer"'),
        }
        for name, (route, hidden) in expected.items():
            text = read(name)
            self.assertIn(route, text, f'{name} posts to the wrong route')
            self.assertIn(hidden, text, f'{name} lost a field the handler reads')

    def test_the_new_password_step_keeps_the_field_names_and_strength_meter(self):
        change = read('password-reset-change-prompt.tpl')
        self.assertIn('name="newpw"', change)
        self.assertIn('name="confirmpw"', change)
        self.assertIn('id="inputNewPassword1"', change)
        self.assertIn('id="inputNewPassword2"', change)
        self.assertIn('using-password-strength', change)
        # The vendor meter id the platform's script updates.
        self.assertIn('passwordStrengthMeterBar', change)


class AuthStylesheetScopeTests(unittest.TestCase):
    """`auth.css` is loaded on every page, so it must only ever match the account pages."""

    def setUp(self):
        self.css = (THEME / 'css' / 'auth.css').read_text()

    def test_every_selector_is_scoped_to_the_auth_namespace(self):
        body = re.sub(r'/\*.*?\*/', '', self.css, flags=re.S)
        offenders = []
        for selector_list in re.findall(r'([^{}]+)\{', body):
            selector_list = selector_list.strip()
            if not selector_list or selector_list.startswith('@'):
                continue
            for selector in selector_list.split(','):
                selector = ' '.join(selector.split())
                if selector and not selector.startswith('.ch-auth'):
                    offenders.append(selector)
        self.assertTrue(offenders == [], f'auth.css reaches beyond the account pages: {offenders[:5]}')
        self.assertGreater(len(re.findall(r'([^{}]+)\{', body)), 40, 'the parser found too little to be believable')

    def test_the_stylesheet_is_loaded_after_the_design_system(self):
        head = read('includes/site-head.tpl')
        order = [line for line in head.splitlines() if 'templates/cloudhost247/css/' in line]
        names = [re.search(r'css/([\w.-]+\.css)', line).group(1) for line in order]
        self.assertIn('auth.css', names)
        self.assertLess(names.index('design-system.css'), names.index('auth.css'),
                        'auth.css must load after the design system it refines')
        self.assertLess(names.index('site.css'), names.index('design-system.css'))


class ParentInheritanceTests(unittest.TestCase):
    def test_the_reset_container_is_not_left_to_the_parent(self):
        # The parent's version exists, so shipping ours must be deliberate and complete.
        shipped = {path.name for path in THEME.glob('*.tpl')}
        self.assertIn('password-reset-container.tpl', shipped)
        self.assertNotIn('pwreset.tpl', shipped,
                         'pwreset.tpl is superseded; the recoverable flow is the password-reset family')


if __name__ == '__main__':
    unittest.main()
