 'use strict';
function Scanner() {
}

Scanner.prototype.startScan = function(extension, config, callback, router) {
	var serialport = require('../../serialport');
	var self = this;

	self.router = router;
	self.config = config;
	self.slaveTimers = {};
	self.connectors = {};
	self.scanCount = 0;
	self.closeConnectors();
	self.clearTimers();
	self.scan(serialport, extension, config, callback);
	self.timer = setInterval(function() {
		self.scan(serialport, extension, config, callback);
	}, 1500);
};

Scanner.prototype.stopScan = function() {
	this.config = undefined;
	this.clearTimers();
	this.closeConnectors();
};

Scanner.prototype.scan = function(serialport, extension, config, callback) {
	var self = this;
	
	if(self.config != config) return;
	serialport.list(function(error, devices) {
		if(error) {
			if(callback) {
				callback(error);
			}
			return;
		}

		var serverMode = config.serverMode;
		var scanType = config.hardware.scanType;
		var vendor = config.hardware.vendor;
		var control = config.hardware.control;
		var duration = config.hardware.duration;
		var firmwarecheck = config.hardware.firmwarecheck;
		var pnpId = config.hardware.pnpId;
		var type = config.hardware.type;
		var checkComPort = (config.select_com_port || type === 'bluetooth' || serverMode === 1) || false;
		var myComPort = config.this_com_port;

		if(checkComPort && !myComPort)  {
			self.router.emit('state', 'select_port', devices);
			callback();
			return;
		}

		if(scanType == 'data') {
			if(self.scanCount < 5) self.scanCount ++;
			else {
				if(devices.some(function(device) {
					var isVendor = false;
					if(Array.isArray(vendor)) {
						isVendor = vendor.some(function (v) {
							return device.manufacturer && device.manufacturer.indexOf(v) >= 0;
						});
					} else {
						if(device.manufacturer.indexOf(vendor) >= 0) {
							isVendor = true;
						}
					}

					return device.manufacturer && isVendor;
				}) == false) {
					vendor = undefined;
				}
			}
		}

		devices.forEach(function(device) {
			if(self.config != config) return;

			var isVendor = false;

			if(Array.isArray(vendor)) {
				isVendor = vendor.some(function (v) {
					return device.manufacturer && device.manufacturer.indexOf(v) >= 0;
				});
			} else if(vendor && device.manufacturer && device.manufacturer.indexOf(vendor) >= 0) {
				isVendor = true;
			}

			if(!vendor || (device.manufacturer && isVendor) || (device.pnpId && device.pnpId.indexOf(pnpId) >= 0) || checkComPort) {
				var comName = device.comName || config.hardware.name;

				if(checkComPort && comName != myComPort) {
					return;
				}

				// comName = '/dev/tty.EV3-SerialPort';

				var connector = self.connectors[comName];
				if(connector == undefined) {
					connector = require('../connector/serial').create();
					self.connectors[comName] = connector;
					connector.open(comName, config.hardware, function(error, sp) {
						if(error) {
							delete self.connectors[comName];
							if(callback) {
								callback(error);
							}
						} else {
							self.setConnector(connector);
							if(control) {
								var flashFirmware;
								if(firmwarecheck) {
									flashFirmware = setTimeout(function () {
										sp.removeAllListeners('data');
										connector.executeFlash = true;
										self.finalizeScan(comName, connector, callback);
									}, 3000);
								}

								if(control == 'master') {
									if(extension.checkInitialData && extension.requestInitialData) {
										sp.on('data', function(data) {
											var result = extension.checkInitialData(data, config);
											if(result === undefined) {
												connector.send(extension.requestInitialData());
											} else {
												sp.removeAllListeners('data');
												clearTimeout(flashFirmware);
												if(result === true) {

													if(extension.setSerialPort) {
														extension.setSerialPort(sp);
													}

													self.finalizeScan(comName, connector, callback);
												} else if(callback) {
													callback(new Error('Invalid hardware'));
												}
											}
										});
									}
								} else {
									if(duration && extension.checkInitialData && extension.requestInitialData) {
										sp.on('data', function(data) {
											var result = extension.checkInitialData(data, config);
											if(result !== undefined) {
												sp.removeAllListeners('data');
												clearTimeout(flashFirmware);
												if(result === true) {
													if(extension.setSerialPort) {
														extension.setSerialPort(sp);
													}
													self.finalizeScan(comName, connector, callback);
												} else if(callback) {
													callback(new Error('Invalid hardware'));
												}
											}
										});
										var slaveTimer = self.slaveTimers[comName];
										if(slaveTimer) {
											clearInterval(slaveTimer);
										}
										slaveTimer = setInterval(function() {
											if(self.config != config) {
												clearInterval(slaveTimer);
												return;
											}
											connector.send(extension.requestInitialData(sp));
										}, duration);
										self.slaveTimers[comName] = slaveTimer;
									}
								}
							} else {
								self.finalizeScan(comName, connector, callback);
							}
						}
					});
				}
			}
		});
	});
};

Scanner.prototype.clearTimers = function() {
	if(this.timer) {
		clearInterval(this.timer);
		this.timer = undefined;
	}
	var slaveTimers = this.slaveTimers;
	if(slaveTimers) {
		var slaveTimer;
		for(var key in slaveTimers) {
			slaveTimer = slaveTimers[key];
			if(slaveTimer) {
				clearInterval(slaveTimer);
			}
		}
	}
	this.slaveTimers = {};
};

Scanner.prototype.setConnector = function(connector) {
	this.router.connector = connector;
	this.router.emit('state', 'before_connect');
};

Scanner.prototype.finalizeScan = function(comName, connector, callback) {
	if(this.connectors && comName) {
		this.connectors[comName] = undefined;
	}
	this.stopScan();

	if(callback) {
		callback(null, connector);
	}
};

Scanner.prototype.closeConnectors = function() {
	var connectors = this.connectors;
	if(connectors) {
		var connector;
		for(var key in connectors) {
			connector = connectors[key];
			if(connector) {
				connector.close();
			}
		}
	}
	this.connectors = {};
};

module.exports = new Scanner();
