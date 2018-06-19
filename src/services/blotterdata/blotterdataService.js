"use strict";
//replace with import when ready
require('@chartiq/finsemble')
//var FSBL = require("@chartiq/finsemble");

const Finsemble = require("@chartiq/finsemble");


const RouterClient = Finsemble.Clients.RouterClient;
const baseService = Finsemble.baseService;
const Logger = Finsemble.Clients.Logger;
Logger.start();
const tradesModule = require('../../tradesdatagenerator');
const positionsModule = require('../../positiondatagenerator');
const pricesModule = require('../../pricedatagenerator');
const tradesDG = new tradesModule.TradesDataGenerator();
const positionsDG = new positionsModule.PositionsDataGenerator();
const pricesDG = new pricesModule.PricesDataGenerator();

/**
 * The blotterdata Service receives calls from the blotterdataClient. 
 * @constructor
 */
function blotterdataService() {

	var self = this;
	var trades = tradesDG.getTrades();
	let instruments = tradesDG.getInstrumentId();
	var prices = pricesDG.getPrices(instruments);
	var positions = positionsDG.getPositions(instruments, trades, prices);
	/**
	 * Creates router endpoints for all of our client APIs. Add servers or listeners for requests coming from your clients.
	 * @private
	 */
	this.createRouterEndpoints = function () {
		//Response for when clients requests initial load of trades
		Finsemble.Clients.RouterClient.addResponder("Trades", function (error, queryMessage) {
			if (!error) {
				queryMessage.sendQueryResponse(null, trades);
			}
		});
		//Response for when clients requests initial load of positions
		Finsemble.Clients.RouterClient.addResponder("Positions", function (error, queryMessage) {
			if (!error) {
				queryMessage.sendQueryResponse(null, positions);
			}
		});
		//Response for when clients requests initial load of prices
		Finsemble.Clients.RouterClient.addResponder("Prices", function (error, queryMessage) {
			if (!error) {
				queryMessage.sendQueryResponse(null, prices);
			}
		});
		//we listen for trades that are edited in a client
		Finsemble.Clients.RouterClient.addListener("TradeEdited", function (error, response) {
			if (error) {
				Logger.log("TradeEdited Error: " + JSON.stringify(error));
			} else {
				//we update our cache of trades
				let tradeIdx = trades.findIndex(x => x.tradeId === response.data.tradeId);
				trades[tradeIdx] = response.data;
				Logger.log("TradeEdited Response: " + JSON.stringify(response));
				response.data.lastUpdated = new Date();
				//we send back the trade on the update trade chanel
				Finsemble.Clients.RouterClient.transmit("UpdateTrade", response.data);
				//we update position
				let newPos = positionsDG.updatePositionWithTradesAndInstrumentId(positions,
					trades,
					response.data.instrumentId);
				Finsemble.Clients.RouterClient.transmit("UpdatePosition", newPos);
			}
		});
		//we listen for prices that are edited in a client
		Finsemble.Clients.RouterClient.addListener("PriceEdited", function (error, response) {
			if (error) {
				Logger.log("PriceEdited Error: " + JSON.stringify(error));
			} else {
				//we update our cache of prices
				let priceIdx = prices.findIndex(x => x.instrumentId === response.data.instrumentId);
				prices[priceIdx] = response.data;
				Logger.log("PriceEdited Response: " + JSON.stringify(response));
				//we update the calculation of the price object
				pricesDG.updateCalculationWhenPriceChange(response.data);
				//we send back the price on the update price chanel
				Finsemble.Clients.RouterClient.transmit("UpdatePrice", response.data);
				//we update position
				let newPos = positionsDG.updatePositionWithPrice(positions, response.data);
				Finsemble.Clients.RouterClient.transmit("UpdatePosition", newPos);
			}
		});
		//every 5 sec we create a new trade
		setInterval(() => {
			let newTrade = tradesDG.createTrade(trades.length + 1);
			trades.push(newTrade);
			Finsemble.Clients.RouterClient.transmit("NewTrade", newTrade);
			//we update position
			let newPos = positionsDG.updatePositionWithTradesAndInstrumentId(positions,
				trades,
				newTrade.instrumentId);
			//we send the updated position
			Finsemble.Clients.RouterClient.transmit("UpdatePosition", newPos);
		}, 5000);
		//every sec we update the consensus price to make some flashing cool stuff on screen
		setInterval(() => {
			let updatedPrice = pricesDG.makeARandomPriceTick(prices);
			Finsemble.Clients.RouterClient.transmit("UpdatePrice", updatedPrice);
		}, 1000);
	};

	return this;
}
blotterdataService.prototype = new baseService();
var serviceInstance = new blotterdataService('blotterdataService');
serviceInstance.addNeededServices(["authenticationService"]);

fin.desktop.main(function () {
	serviceInstance.setOnConnectionComplete(function (callback) {
		Logger.debug("onConnectionCompleteCalled");
		serviceInstance.createRouterEndpoints();
		callback();
	});
})


serviceInstance.start();
module.exports = serviceInstance;