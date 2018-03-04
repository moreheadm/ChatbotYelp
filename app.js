/*-----------------------------------------------------------------------------
A simple echo bot for the Microsoft Bot Framework.
-----------------------------------------------------------------------------*/

//Run "npm install dotenv --save" on terminal
require('dotenv').load()

var restify = require('restify');
var builder = require('botbuilder');
var botbuilder_azure = require("botbuilder-azure");
var https = require('https');
//var bing_search = require('./api-handler-service');

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword
    //openIdMetadata: process.env.BotOpenIdMetadata
});

// Listen for messages from users
server.post('/api/messages', connector.listen());

/*----------------------------------------------------------------------------------------
* Bot Storage: This is a great spot to register the private state storage for your bot.
* We provide adapters for Azure Table, CosmosDb, SQL Azure, or you can implement your own!
* For samples and documentation, see: https://github.com/Microsoft/BotBuilder-Azure
* ---------------------------------------------------------------------------------------- */

var tableName = 'botdata';
var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);

var inMemoryStorage = new builder.MemoryBotStorage();

// Create your bot with a function to receive messages from the user
var bot = new builder.UniversalBot(connector);
bot.set('storage', tableStorage);

// Make sure you add code to validate these fields
var luisAppId = process.env.luisAppId;
var luisAPIKey = process.env.luisAPIKey;
var luisAPIHostName = process.env.LuisAPIHostName || 'westus.api.cognitive.microsoft.com';

// For the Bing Entity Search API
var bingAPIKey = process.env.bingAPIKey;
var headers = { "Ocp-Apim-Subscription-Key": bingAPIKey }

const LuisModelUrl = 'https://' + luisAPIHostName + '/luis/v1/application?id=' + luisAppId + '&subscription-key=' + luisAPIKey;
const bingUrl = 'https://api.cognitive.microsoft.com/bing/v7.0/entities';

// Main dialog with LUIS
var recognizer = new builder.LuisRecognizer(LuisModelUrl);
var intents = new builder.IntentDialog({ recognizers: [recognizer] })
    .matches('Greeting', (session) => {
        session.send('Hello there! This is a chat bot for you to explore new food or make a reservation!', session.message.text);
    })
    .matches('Help', (session) => {
        session.send('You reached Help intent, you said \'%s\'.', session.message.text);
    })
    .matches('Cancel', (session) => {
        session.send('You reached Cancel intent, you said \'%s\'.', session.message.text);
    })
    /*
    .matches('<yourIntent>')... See details at http://docs.botframework.com/builder/node/guides/understanding-natural-language/
    */
    .matches('Reservation', (session) => {
        session.beginDialog('/MakeReservation');
    })
    .matches('Recommendation', (session) => {
        session.beginDialog('/MakeRecommendation');
    })
    .onDefault((session) => {
        session.send('Sorry, I did not understand \'%s\'.', session.message.text);
    });

bot.dialog('/MakeReservation', [
    function (session) {
        session.send("Welcome to the dinner reservation.");
        builder.Prompts.time(session, "Please provide a reservation date and time (e.g.: June 6th at 5pm)");
    },
    function (session, results) {
        session.dialogData.reservationDate = builder.EntityRecognizer.resolveTime([results.response]);
        builder.Prompts.text(session, "How many people are in your party?");
    },
    function (session, results) {
        session.dialogData.partySize = results.response;
        builder.Prompts.text(session, "Who's name will this reservation be under?");
    },
    function (session, results) {
        session.dialogData.reservationName = results.response;

        // Process request and display reservation details
        session.send(`Reservation confirmed. Reservation details: <br/>Date/Time: ${session.dialogData.reservationDate} <br/>Party size: ${session.dialogData.partySize} <br/>Reservation name: ${session.dialogData.reservationName}`);
        session.endDialog();
    }
])

var body = '';
// Gets the JSON object.
let response_handler = function (response) {
    //body = '';
    response.on('data', function (d) {
        body += d;
    });
    response.on('end', function () {
        console.log('\nRelevant Headers:\n');
        for (var header in response.headers)
            // header keys are lower-cased by Node.js
            if (header.startsWith("bingapis-") || header.startsWith("x-msedge-"))
                 console.log(header + ": " + response.headers[header]);
        body = JSON.stringify(JSON.parse(body), null, '  ');
        console.log('\nJSON Response:\n');
        console.log(body);
    });
    response.on('error', function (e) {
        console.log('Error: ' + e.message);
    });
};

// Calling the bing search.
let bing_web_search = function (search) {
    console.log('Searching the Web for: ' + search);
    let request_params = {
          method : 'GET',
          hostname : 'api.cognitive.microsoft.com',
          path : '/bing/v7.0/entities' + '?q=' + encodeURIComponent(search),
          headers : {
              'Ocp-Apim-Subscription-Key' : bingAPIKey,
          }
      };
  
      let req = https.request(request_params, response_handler);
      req.end();
  }

// Makes a recommendation for the user.
bot.dialog('/MakeRecommendation',[
    function(session) {
        session.send("I'm gonna try and help you look for something new to eat.");
        builder.Prompts.text(session, "What kind of food are you craving?");
    },
    function(session, results) {
        session.dialogData.cuisine = results.response;
        builder.Prompts.choice(session, "What is your price range?", 'Economic|Reasonable|Expensive', {listStyle : 3});
    },
    function(session, results) {
        var budgets = ['Cheap','Reasonable','Expensive'];
        if(results.response) {
            session.dialogData.budget = budgets[results.response.index];
        }
        
        // Query for the bing search.
        var query = `${session.dialogData.budget} ${session.dialogData.cuisine} restaurants near me`;

        bing_web_search(query);

        // Parsing the response object.
        obj = JSON.parse(body);
          

        session.endDialog();
    }
])

bot.dialog('/', intents);

