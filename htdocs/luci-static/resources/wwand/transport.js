'use strict';
'require baseclass';
'require ui';
'require rpc';

/* Keep board actions independent of an older cached shared RPC module. */
function checked(method, params) {
	var call = rpc.declare({ object: 'wwand', method: method, params: params || [], expect: {}, reject: true });
	return function() {
		return call.apply(this, arguments).catch(function(e) {
			return { ok: false, error: e && e.message ? e.message : String(e) };
		});
	};
}
var wrpc = {
	pcieRescan: checked('pcie_rescan'),
	getDataMode: checked('modem_get_data_mode'),
	setDataMode: checked('modem_set_data_mode', [ 'mode' ])
};

/* Board controls stay reachable on a fresh installation with no modem row. */
return baseclass.extend({
	render: function(board) {
		var transport = board && board.transport;
		if (!transport || !transport.supported)
			return Promise.resolve(null);
		var readonly = !L.hasViewPermission();
		var message = E('p', { 'role': 'status', 'aria-live': 'polite' });
		var rescan = E('button', {
			'class': 'btn cbi-button cbi-button-action', 'type': 'button',
			'disabled': readonly || null,
			'click': ui.createHandlerFn(this, function() {
				return wrpc.pcieRescan().then(function(result) {
					message.textContent = result.ok
						? (result.found ? ''
							: _('The PCIe modem is still missing. You can rescan again.'))
						: _('Rescan failed: %s').format(result.error || _('unknown error'));
				});
			})
		}, _('Rescan PCIe'));
		var content = [
			E('h3', {}, _('Modem setup')),
			E('p', {}, _('If the PCIe modem is missing, rescan the bus. Rescan does not reset the modem.')),
		];
		if (!transport.data_mode) {
			content.push(rescan, message);
			return Promise.resolve(E('div', { 'class': 'cbi-section' }, content));
		}

		var current = null, working = false;
		var select = E('select', { 'id': 'wwand-data-mode', 'class': 'cbi-input-select', 'disabled': 'disabled' }, [
			E('option', { 'value': '' }, _('Unknown')),
			E('option', { 'value': 'usb' }, _('USB')),
			E('option', { 'value': 'pcie' }, _('PCIe'))
		]);
		var modeStatus = E('p', { 'role': 'status', 'aria-live': 'polite' }, _('Reading modem data mode…'));
		var update = function() {
			select.disabled = readonly || working || !current;
			apply.disabled = readonly || working || !current || select.value == current;
			read.disabled = working;
			rescan.disabled = readonly || working;
		};
		var readMode = function() {
			working = true;
			update();
			return wrpc.getDataMode().then(function(result) {
				current = result.ok && (result.mode == 'usb' || result.mode == 'pcie') ? result.mode : null;
				select.value = current || '';
				modeStatus.textContent = current ? _('Saved data mode: %s').format(current.toUpperCase())
					: _('Cannot read data mode: %s. Check the USB AT connection and read again.').format(result.error || _('unknown error'));
			}).finally(function() { working = false; update(); });
		};
		var read = E('button', { 'class': 'btn cbi-button', 'type': 'button',
			'click': ui.createHandlerFn(this, readMode) }, _('Read again'));
		var apply = E('button', { 'class': 'btn cbi-button cbi-button-apply', 'type': 'button',
			'disabled': 'disabled',
			'click': ui.createHandlerFn(this, function() {
				if (readonly || working || !current || select.value == current)
					return;
				var mode = select.value;
				if (!confirm(_('Save %s as the modem data mode? This setting persists across reboots. Reboot the router to use it.').format(mode.toUpperCase())))
					return;
				working = true;
				update();
				return wrpc.setDataMode(mode).then(function(result) {
					if (result.ok) {
						current = result.mode;
						modeStatus.textContent = result.restart_required
							? _('Data mode saved. Reboot the router to use it.')
							: _('The modem already uses this saved data mode.');
					}
					else {
						current = null;
						modeStatus.textContent = _('Could not confirm data mode: %s. Read again before retrying.').format(result.error || _('unknown error'));
					}
				}).finally(function() { working = false; update(); });
			}) }, _('Apply data mode'));
		select.addEventListener('change', update);
		content.push(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title', 'for': 'wwand-data-mode' }, _('Modem data mode')),
			E('div', { 'class': 'cbi-value-field' }, [ select, ' ', apply, ' ', read, ' ', rescan,
				E('div', { 'class': 'cbi-value-description' }, _('USB uses the modem USB data interface. PCIe uses MHI. Apply saves the setting; it does not reset the modem.')),
				modeStatus, message ])
		]));
		var node = E('div', { 'class': 'cbi-section' }, content);
		return readMode().then(function() { return node; });
	}
});
