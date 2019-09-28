const Finsemble = require("@chartiq/finsemble");
const {
	RouterClient,
	Logger,
	WorkspaceClient,
	DialogManager,
	ConfigClient
} = Finsemble.Clients;

Logger.start();
Logger.log("shutdown Service starting up");

// Add and initialize any other clients you need to use
//   (services are initialised by the system, clients are not)
// let StorageClient = Finsemble.Clients.StorageClient;
// StorageClient.initialize();
WorkspaceClient.initialize();
ConfigClient.initialize();
DialogManager.initialize();

/**
 *
 * @constructor
 */
function shutdownService() {
	const self = this;
	let shutDownTimer = null;

	this.shutdownFunction = function() {
		ConfigClient.getValue(
			{ field: "finsemble.scheduledShutdown" },
			(err, config) => {
				//Allow the timeout for the restart dialog to be driven by config. See checkForScheduledRestart comments for format.
				let scheduledShutdownTimeout = 60000;
				//If the dialogTimeout property exists and is a number, override our default.
				if (config && !isNaN(config.dialogTimeout)) {
					scheduledShutdownTimeout = config.dialogTimeout;
				}
				//create an object for the 2nd arg so that the scheduleRestart function doesn't have to change.
				if (config) {
					Logger.system.log(
						"APPLICATION LIFECYCLE:SCHEDULED SHUTDOWN TIME:",
						config
					);
				} else {
					Logger.system.log(
						"APPLICATION LIFECYCLE:SCHEDULED SHUTDOWN NOT CONFIGURED."
					);
				}
				scheduleShutdown(err, config);
			}
		);

		//If the user changes it via the preferences API, we catch the change here, log it out, and schedule the restart.
		ConfigClient.addListener(
			{ field: "finsemble.scheduledShutdown" },
			(err, config) => {
				if (config.value) {
					Logger.system.log(
						"APPLICATION LIFECYCLE:SCHEDULED SHUTDOWN TIME CHANGED. NEW TIME:",
						config.value
					);
				} else {
					Logger.system.log(
						"APPLICATION LIFECYCLE:SCHEDULED SHUTDOWN DISABLED."
					);
				}
				scheduleShutdown(err, config.value);
			}
		);

		/**
		 * Saves workspace and if it is dirty then  fires off a message shutting down the application.
		 */
		const saveWorkspace = () => {
			if (!WorkspaceClient.activeWorkspace.isDirty) {
				return Promise.resolve();
			}

			return new Promise((resolve, reject) => {
				DialogManager.onReady(() => {
					DialogManager.open(
						"yesNo",
						{
							monitor: "primary",
							title: "Scheduled Shutdown",
							question:
								"The application will shutdown in one minute. Your workspace will be saved.",
							showTimer: true,
							timerDuration: 60000,
							showNegativeButton: false,
							affirmativeResponseLabel: "Shutdown Now"
						},
						async (err, response) => {
							if (err) reject(err);
							try {
								if (response.choice === "cancel") {
									//do stuff here
									resolve(response.choice);
								} else {
									// save the workspace
									Logger.info("Saving workspace.");
									await WorkspaceClient.save();
									Logger.info("Workspace saved successfully.");
									resolve(response.choice);
								}
							} catch (error) {
								const errorMessage = `Failed to save workspace: ${error}`;
								Logger.warn(errorMessage);
								reject(errorMessage);
							}
						}
					);
				});
			});
		};

		const shutdownFinsemble = async () => {
			// if the user cancels the event then don't shutdown
			if ((await saveWorkspace()) === "cancel") return;
			// code to shutdown Finsemble
			RouterClient.transmit("Application.shutdown");
		};

		function scheduleShutdown(err, config) {
			if (config) {
				const daysUntilShutdown = (restartDay, today) => {
					const shutdownIsToday = restartDay - today === 0;
					const shutdownIsNextWeek = restartDay - today < 0;

					if (shutdownIsToday) {
						return 0;
					} else if (shutdownIsNextWeek) {
						// 6 is how many full days until the same day next week
						return restartDay - today + 6;
					} else {
						// shutdown day is coming up soon this week
						return restartDay - today;
					}
				};

				const timeInMsToShutdown = (shutdownTime, now) => {
					// ensure the time has not passed
					if (shutdownTime - now < 0) {
						//if the time has passed then set the day to next week (same day)
						shutdownTime.setDate(shutdownTime.getDate() + 7);
					}
					return shutdownTime - now;
				};

				const now = new Date();

				const shutdownTime = new Date();
				// using days to set the date for shutdown
				shutdownTime.setDate(
					now.getDate() + daysUntilShutdown(config.day, now.getDay())
				);
				shutdownTime.setHours(config.hour);
				shutdownTime.setMinutes(config.minute);

				const countdownTillShutdown = timeInMsToShutdown(shutdownTime, now);

				// countdown timer until the shutdown
				shutDownTimer = setTimeout(() => {
					shutdownFinsemble();
				}, countdownTillShutdown);
				shutDownTimer;
			} else {
				if (shutDownTimer) {
					// clear the timer just in case there is an existing one set up
					clearTimeout(shutDownTimer);
				}
			}
		}
	};

	return this;
}

shutdownService.prototype = new Finsemble.baseService({
	startupDependencies: {
		// add any services or clients that should be started before your service
		services: [],
		clients: ["configClient", "workspaceClient", "dialogManager"]
	}
});
const serviceInstance = new shutdownService("shutdownService");

serviceInstance.onBaseServiceReady(function(callback) {
	// serviceInstance.createRouterEndpoints();
	Logger.log("shutdown Service ready");
	serviceInstance.shutdownFunction();
	callback();
});

serviceInstance.start();
module.exports = serviceInstance;