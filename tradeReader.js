/**
 * Author: _MotokoKusanagi (discord: motokusanagi)
 * Contact for help/assistance.
 * 
 * Coordindates idea/suggestion by Gjum.
 * 
 * How to setup:
 * 1. open JSMacros ui.
 * 2. Go to `Services` tab in bottom lefthand corner.
 * 3. Click `+` top right to add another entry, and name service (i.e. "IEC logger")
 * 4. Click middle File field, navigate to location of this file and select it.
 * 5. Enable and start running the service, you should see a message saying the service has started. 
 * 
 * How to Use:
 * Punch any iec chest while service is running. Check the output file to see the exchange trade csv (comma separated value) appended to the output file.
 * New exchange log entries are appended to the end of the log file. 
 * Need to run /cti to enable location logging while service is running/
 * 
 * Configuration:
 * To change the output logfile location change the below `TRADE_OUTPUT_FILE` variable value.
 * 
 * How it works:
 * Whenever you recieve any chat message the service first checks if the message is formatted like the first `(X/Y) exchanges present.` line.
 * Service then starts to look for the input line; logging the input item name and count, 
 * followed by output line; logging the output item name and count, 
 * followed by the final line of exchanges available line; logging of the number of exchanges left.
 * Service then starts to look for the first `(X/Y) exchanges present` messages again. 
 * Process continues unless stopped by user or when user leaves game.
 * Process cleans up message listener to prevent any zombie listening.
 * CTI location checking and compacted input/output slightly change exact order and add some complexity, but the above is a simplified version of the below.
 */

// used when service starts and ends to log a message in chat to notify the user.
const SERVICE_NAME = event.serviceName

// #region MESSAGE TARGET PARTS CONSTANTS
// text parts to determine if message is a line in the 
const EXCHANGES_PRESENT_PART = " exchanges present."
const INPUT_PART = "Input: "
const OUTPUT_PART = "Output: "
const COMPACTED_ITEM_PART = "Compacted Item"
const EXCHANGES_AVAILABLE_PART = " exchanges available."
const CTI_MODE_CHANGE_PART = "Toggled reinforcement information mode "

const PURPLE_COLOR = "dark_purple"
// #endregion

// #region config
/***************CONFIG*******************************************/

// change to where you want output file and with what name.
// text is appended to the end of the current file there.
const TRADE_OUTPUT_FILE = "trades.txt"

/****************************************************************/
// #endregion

let currentLine = EXCHANGES_PRESENT_PART
let currentCompacted = false
let CTIMode = false
let CTILocation = ''
let tradeString = ""


/**
 * Checks provided message is apart of an iec exchange trade chat message. Once all four lines of the exchange trade have been read, logs trade to a file.
 * 
 * Example recvMessage event's text JSON objects:
 * 
 * Exchanges present:
 * In game: `(1/2) exchanges present`
 * Formatted text JSON: `{extra: [{bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false, color: "yellow", text: "(1/2) exchanges present."}], text: ""}`
 * 
 * Input:
 * In game: `Input: 11 Iron Ingots`
 * Formatted text JSON: `{extra: [{bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false, color: "yellow", text: "Input: "}, {italic: false, color: "white", text: "11 Iron Ingot"}], text: ""}`
 * 
 * Output:
 * In game: `Output: 1 Diamond`
 * Formatted text JSON: `{extra: [{bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false, color: "yellow", text: "Output: "}, {italic: false, color: "white", text: "1 Diamond"}], text: ""}`
 * 
 * Compacted items are in Output/Input:
 * In game: `Compacted Item`
 * Formatted text JSON: `{extra: [{bold: false, italic: true, underlined: false, strikethrough: false, obfuscated: false, color: "dark_purple", text: "Compacted Item"}], text: ""}`
 * 
 * Exchanges available:
 * In game: `0 exchanges available.`
 * Formatted text JSON: `{extra: [{bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false, color: "yellow", text: "0 exchanges available."}], text: ""}`
 * 
 * CTI hover text:
 * In game: `100% (300/300)` (floating green text)
 * Formatted text JSON: `{hoverEvent: {action: "show_text", contents: {text: "Location: -3807 69 -4307"}}, text: "Reinforced at 100% (300/300) health with Iron"`
 * 
 * CTI command ran:
 * In game: `Toggled reinforcement information mode off`
 * Formatted text JSON: `{extra: [{bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false, color: "green", text: "Toggled reinforcement information mode "}, {italic: false, color: "yellow", text: "off"}], text: ""}`
 * 
 * @param {RecvMessage} recvMessageEvent New message player has received
 */
function HandleReader(recvMessageEvent) {
    let msg = JSON.parse(recvMessageEvent.text.getJson()) // get formatted message from the event
    let msgExtraText = msg.extra?.at(0).text // get extra (formatted) text from the message
    
    if (msgExtraText == CTI_MODE_CHANGE_PART) { // check for CTI change
        CTIMode = msg.extra[1].text == "on"
    } else if (currentLine == EXCHANGES_AVAILABLE_PART && msg.hoverEvent?.contents?.text != null) { // check for cti reinforcement message after exchanges available
        let locationArray = msg.hoverEvent.contents?.text.split(' ')
        tradeString += `,${locationArray[1]},${locationArray[2]},${locationArray[3]}`
       tradeReadComplete()
    } else if (currentLine == EXCHANGES_PRESENT_PART && msgExtraText?.split(')')[1] == EXCHANGES_PRESENT_PART) { // exchanges present check
        // just move currentLine to next trade line
        // nothing important to add to log message
        currentLine = INPUT_PART
    } else if(currentLine == INPUT_PART && msgExtraText == INPUT_PART) { // input line check
        inputOutputLineHelper(msg)
        currentLine = OUTPUT_PART
    } else if (currentLine == OUTPUT_PART && msgExtraText == OUTPUT_PART) { // output line check
        tradeString += `${currentCompacted},` // whether or not input is compacted
        inputOutputLineHelper(msg)
        currentLine = EXCHANGES_AVAILABLE_PART
    } else if (currentLine == EXCHANGES_AVAILABLE_PART && msgExtraText?.slice(msgExtraText?.indexOf(' ')) == EXCHANGES_AVAILABLE_PART) { // available line check
        tradeString += `${currentCompacted},` // whether or not output is compacted
        exchangeAvailable(msgExtraText)
    } else if ((currentLine == OUTPUT_PART || currentLine == EXCHANGES_AVAILABLE_PART)) { // post input/output compacted item check
        currentCompacted = (msgExtraText == COMPACTED_ITEM_PART)
    }
}

/**
 * Helper method as the input and output trade lines are identical for our purposes.
 * Gets the first number as the count of items and adds to log string.
 * Gets the rest of string after first number as the name of item in trade and adds to log string.
 * @param {*} msg 
 */
function inputOutputLineHelper(msg) {
    let itemCountString = msg.extra[1].text.split(' ', 1)[0]
    let itemNameString = msg.extra[1].text.substring(itemCountString.length + 1)

    tradeString += `${itemCountString},${itemNameString},`
    currentCompacted = false // reset compact tracking
}

/**
 * Reached when exchanges available line is reached. If cti hasn't been enabled while running
 * trade read is complete.
 * @param {*} msgExtraText 
 */
function exchangeAvailable(msgExtraText) {
    tradeString += `${msgExtraText?.split(' ', 1)[0]}` // add exchanges left count
    if (!CTIMode) { // if cti was enabled during running, wait until cti hover text before logging 
        tradeString += ',,,' // no location!
        tradeReadComplete()
    }
    currentCompacted = false // reset compact tracking
}

/**
 * IEC exchange trade is fully read. Logs out the current trade string.
 * Resets tradeString and currentLine to prepare for next potential trade.
 */
function tradeReadComplete() {
    FS.open(TRADE_OUTPUT_FILE).append(tradeString + '\n') // write trade string to log file
    tradeString = '' // reset logger string
    currentLine = EXCHANGES_PRESENT_PART // look for start of a new exchange trade
}

/**
 * Starts an event listener for when the player receives a message to trigger a trade read.
 * Also cleans up the listener when the service is stopped.
 */
function startReader() {
    Chat.log(`STARTING ${SERVICE_NAME}`)
    let listener = JsMacros.on('RecvMessage', JavaWrapper.methodToJava(HandleReader))

    event.stopListener = JavaWrapper.methodToJava(() => { // clean up service
        JsMacros.off(listener)
        Chat.log(`${SERVICE_NAME} STOPPED.`)
    })
}

startReader()