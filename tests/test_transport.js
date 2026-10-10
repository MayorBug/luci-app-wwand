/* Exercise the actual LuCI component with a small DOM and RPC seam. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
String.prototype.format = function(...args) { let i = 0; return this.replace(/%s/g, () => args[i++]); };
let writeAllowed = true, mode = 'usb', calls = [], readError = false, setError = false, consent = true;
class Element {
	constructor(tag, attrs, children) {
		this.tag = tag; this.attrs = attrs; this.children = children;
		this.disabled = !!attrs.disabled; this.value = '';
		this.events = {}; this.textContent = typeof children == 'string' ? children : '';
	}
	addEventListener(name, fn) { this.events[name] = fn; }
}
const E = (tag, attrs = {}, children = []) => new Element(tag, attrs, children);
const rpc = {
	getDataMode: async () => { calls.push('read'); return readError ? { ok: false, error: 'no_at_port' } : { ok: true, mode }; },
	setDataMode: async selected => { calls.push('set:' + selected); if (setError) return { ok: false, error: 'readback_failed' };
		mode = selected; return { ok: true, mode, restart_required: true }; },
	pcieRescan: async () => { calls.push('rescan'); return { ok: true, found: false }; }
};
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/wwand/transport.js'), 'utf8');
const component = new Function('baseclass', 'ui', 'rpc', 'L', 'E', '_', 'confirm', source)(
	{ extend: obj => obj }, { createHandlerFn: (ctx, fn) => fn.bind(ctx) },
	{ declare: decl => {
		assert.equal(decl.object, 'wwand');
		assert.equal(decl.reject, true);
		return { modem_get_data_mode: rpc.getDataMode, modem_set_data_mode: rpc.setDataMode, pcie_rescan: rpc.pcieRescan }[decl.method];
	} },
	{ hasViewPermission: () => writeAllowed }, E, text => text, () => consent);
function all(node) {
	if (!(node instanceof Element)) return [];
	return [node, ...[].concat(node.children).flatMap(all)];
}
const button = (node, label) => all(node).find(e => e.tag == 'button' && e.textContent == label);
const picker = node => all(node).find(e => e.tag == 'select');
const profile = { transport: { supported: true, data_mode: true, endpoints: [] } };
(async () => {
	assert.equal(await component.render(null), null);
	let node = await component.render(profile);
	assert.deepEqual(calls, ['read'], 'page load reads; no persistent write');
	assert.equal(picker(node).value, 'usb');
	assert.equal(button(node, 'Apply data mode').disabled, true);
	picker(node).value = 'pcie'; picker(node).events.change();
	assert.equal(button(node, 'Apply data mode').disabled, false);
	assert.deepEqual(calls, ['read'], 'changing the picker never writes');
	consent = false;
	await button(node, 'Apply data mode').attrs.click();
	assert.deepEqual(calls, ['read'], 'cancel keeps modem settings');
	consent = true;
	await button(node, 'Apply data mode').attrs.click();
	assert.deepEqual(calls, ['read', 'set:pcie']);
	assert.ok(all(node).some(e => e.textContent == 'Data mode saved. Reboot the router to use it.'));
	assert.equal(button(node, 'Apply data mode').disabled, true);
	await button(node, 'Rescan PCIe').attrs.click();
	assert.deepEqual(calls, ['read', 'set:pcie', 'rescan'], 'rescan does not save mode or reset');
	assert.ok(all(node).some(e => e.textContent.includes('still missing')));
	writeAllowed = false; calls = [];
	node = await component.render(profile);
	assert.equal(picker(node).disabled, true);
	assert.equal(button(node, 'Rescan PCIe').disabled, true);
	assert.equal(button(node, 'Apply data mode').disabled, true);
	assert.deepEqual(calls, ['read'], 'read-only role can read mode');
	writeAllowed = true; readError = true; calls = [];
	node = await component.render(profile);
	assert.equal(button(node, 'Apply data mode').disabled, true, 'failed read never enables a guessed default');
	assert.equal(picker(node).value, '');
	assert.ok(all(node).some(e => e.textContent.includes('no_at_port')));
	readError = false;
	await button(node, 'Read again').attrs.click();
	assert.equal(picker(node).disabled, false);
	picker(node).value = 'usb'; picker(node).events.change(); setError = true;
	await button(node, 'Apply data mode').attrs.click();
	assert.equal(button(node, 'Apply data mode').disabled, true, 'uncertain write requires a fresh read');
	assert.ok(all(node).some(e => e.textContent.includes('Read again before retrying')));
	const acl = JSON.parse(fs.readFileSync(path.join(__dirname, '../root/usr/share/rpcd/acl.d/luci-app-wwand.json')));
	const role = acl['luci-app-wwand'];
	assert.ok(role.read.ubus.wwand.includes('modem_get_data_mode'));
	assert.ok(!role.read.ubus.wwand.includes('modem_set_data_mode'));
	assert.ok(!role.read.ubus.wwand.includes('pcie_rescan'));
	assert.ok(role.write.ubus.wwand.includes('modem_set_data_mode'));
	assert.ok(role.write.ubus.wwand.includes('pcie_rescan'));
	console.log('transport UI: all checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
