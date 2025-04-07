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
 *  5a. If FORCE_ENABLE_CTI enabled, might see one or two /cti commands run.
 * 6. Disable service to have results outputted to JSON or MD file. Results are outputed to CSV file as you punch.
 * 
 * How to Use:
 * Punch any iec chest while service is running. Check the output file to see the exchange trade csv (comma separated value) appended to the output file.
 * New exchange log entries are appended to the end of the log file. 
 * 
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
 * 
 * 
 */



class TradeReader {
    // #region config
    /***************CONFIG*******************************************/

    // change to where you want output file and with what name.
    // text is appended to the end of the current file there.
    TRADE_OUTPUT_FOLDER = "exchanges/"
    TRADE_OUTPUT_FILE = "trades"

    // outputs empty or low exchanges to a file
    STOCK_WARNING_OUTPUT = false
    STOCK_WARNING_OUTPUT_FILE = "stock-warning.txt"
    // minimum value needed for exchanges to be included in stock warning log. Set to -1 to exclude all exchanges.
    STOCK_WARNING_THRESHOLD = 5
    
    // output all found exchanges to a json file
    JSON_OUTPUT = true
    
    // formatted output of all found exchanges to a csv file
    CSV_OUTPUT = true

    // Enable cti via /cti if not already enabled
    FORCE_ENABLE_CTI = true

    /****************************************************************/
    // #endregion

    // #region IEC TRADE LINE REGEX
    EXCHANGES_PRESENT_REGEX = /^^\((?<current>[0-9]+)\/(?<max>[0-9]+)\) exchanges present.$/
    INPUT_TEXT_REGEX = /^Input: /gm
    MATERIAL_QUANTITY_REGEX = /(?<amount>[0-9]+)\s(?<material>.*)$/
    OUTPUT_TEXT_REGEX = /^Output: /gm
    COMPACTED_ITEM_REGEX = /^Compacted Item$/gm
    EXCHANGES_AVAILABLE_REGEX = /^(?<amount>[0-9]+) exchanges? available.$/
    CTI_HOVER_REGEX = /^(?:Location: )(?<x>-?[0-9]+) (?<y>-?[0-9]+) (?<z>-?[0-9]+)$/
    CTI_TOGGLE_REGEX = /^Toggled reinforcement information mode $/
    CTI_MODE_REGEX = /^(off|on)$/

    START_REGEX = this.EXCHANGES_PRESENT_REGEX
    // #endregion

    // #region Don't touch!
    OUTPUT_FILE_HEADER = "input_count,input_item,is_compacted,output_count,output_item,is_compacted,exchanges_available,x,y,z"
    name = "TradeReader"
    currentRegex = this.EXCHANGES_PRESENT_REGEX
    trade = {"input-compacted": false, "output-compacted": false}
    currentExchange = {}
    messageListener;
    draw3D;
    // #endregion

    static #_instance
    static instance = (() => {
        return !!(this.#_instance) ? this.#_instance : new TradeReader()
    })()

    /**
     * Starts an event listener for when the player receives a message to trigger a trade read.
     */
    Start() {
        if (!!this.messageListener) {
            Chat.log(`${this.name} already running...`)
            return 
        }
        Chat.log(`STARTING ${this.name}`)
        if (this.CSV_OUTPUT) {
            if (!FS.exists(this.TRADE_OUTPUT_FOLDER))
                FS.makeDir(this.TRADE_OUTPUT_FOLDER) ? {} : this.TRADE_OUTPUT_FOLDER = "" 
            FS.unlink(`${this.TRADE_OUTPUT_FOLDER}${this.TRADE_OUTPUT_FILE}.csv`)
            if (!FS.exists(`${this.TRADE_OUTPUT_FOLDER}${this.TRADE_OUTPUT_FILE}.csv`))
                FS.open(`${this.TRADE_OUTPUT_FOLDER}${this.TRADE_OUTPUT_FILE}.csv`).append(this.OUTPUT_FILE_HEADER + '\n')
        }
        this.messageListener = JsMacros.on('RecvMessage', JavaWrapper.methodToJava(TradeReader.HandleMessage))
        if (this.FORCE_ENABLE_CTI) {
            this.currentRegex = this.CTI_TOGGLE_REGEX
            Chat.say('/cti')
        }
        this.exchangeList = []
        this.draw3D = Hud.createDraw3D()
    }

    Stop() {
        if (!!!this.messageListener)
            return 
        JsMacros.off(this.messageListener)
        if (this.JSON_OUTPUT) {
            const JSON_FILE = this.TRADE_OUTPUT_FILE + ".json"
            FS.unlink(JSON_FILE)
            FS.open(JSON_FILE).append(JSON.stringify({"data":this.exchangeList}))
            Chat.log(`[${this.name}] completed JSON output`)
        }
        if (this.STOCK_WARNING_OUTPUT) {
            this.WriteStockWarning()
            Chat.log(`[${this.name}] completed Stock warning output`)
        }
        this.messageListener = null
        this.exchangeList = []
        this.draw3D.unregister()
        Chat.log(`${this.name} STOPPED.`)
    }

    /**
     * Checks provided message is apart of an iec exchange trade chat message. Once all four lines of the exchange trade have been read, logs trade to a file.
     * 
     * Example recvMessage event's text JSON objects:
     * 
     * Exchanges present:
     * In game: `(1/2) exchanges present.`
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
    HandleMessage(recvMessageEvent) {
        let msg = JSON.parse(recvMessageEvent.text.getJson()) // get formatted message from the event
        let msgExtra = msg.extra // get extra (formatted) text from the message
        let hoverEvent = msg.hoverEvent
        if (!hoverEvent && !msgExtra)
            return

        let msgExtraFirstText = msgExtra?.at(0)?.text
        switch (this.currentRegex) {
            case this.CTI_TOGGLE_REGEX:
                if (!msgExtraFirstText || !msgExtraFirstText.match(this.CTI_TOGGLE_REGEX)) 
                    return;
                this.currentRegex = this.START_REGEX
                if (msgExtra[1]?.text != "on")
                    Chat.say('/cti')
                break;
            case this.EXCHANGES_PRESENT_REGEX:
                if (!msgExtraFirstText) return;
                let exchangesPresentMatch = msgExtraFirstText.match(this.currentRegex)
                if (!exchangesPresentMatch) return;
                const {current, max} = exchangesPresentMatch.groups
                this.trade["current-index"] = current
                this.trade["max-index"] = max
                this.currentRegex = this.INPUT_TEXT_REGEX
                break;
            case this.INPUT_TEXT_REGEX:
                if (!msgExtraFirstText || !msgExtraFirstText.match(this.currentRegex) || !msgExtra[1]?.text)
                    return
                this.HandleMaterialQuantityText(msgExtra[1].text)
                this.currentRegex = this.OUTPUT_TEXT_REGEX
                break;
            case this.OUTPUT_TEXT_REGEX:
                if (!msgExtraFirstText) return;

                if (msgExtraFirstText.match(this.COMPACTED_ITEM_REGEX)) { // input compacted message comes before output info
                    let direction = Object.hasOwn(this.trade, "output-material") ? "out" : "in"
                    this.trade[`${direction}put-compacted`] = true
                }
                else if (msgExtraFirstText.match(this.OUTPUT_TEXT_REGEX)) {
                    this.HandleMaterialQuantityText(msgExtra[1].text)
                    this.currentRegex = this.EXCHANGES_AVAILABLE_REGEX
                }

                break;
            case this.EXCHANGES_AVAILABLE_REGEX:
                if (!msgExtraFirstText) return;
                let exchangeAvailableMatch = this.EXCHANGES_AVAILABLE_REGEX.exec(msgExtraFirstText)
                if (!exchangeAvailableMatch) return

                let { amount } = exchangeAvailableMatch.groups
                this.trade["exchanges-available"] = amount
                
                if (this.FORCE_ENABLE_CTI) {
                    this.currentRegex = this.CTI_HOVER_REGEX
                    return;
                }

                this.SaveTrade()
                this.currentRegex = this.START_REGEX
                break;
            case this.CTI_HOVER_REGEX:
                if (!hoverEvent?.contents) 
                    return
                let CTILocationMatch = this.CTI_HOVER_REGEX.exec(hoverEvent.contents)
                if (!CTILocationMatch) return;

                let {x, y, z} = CTILocationMatch.groups
                this.trade['x'] = x
                this.trade['y'] = y
                this.trade['z'] = z
                this.SaveTrade()
                this.draw3D.addPoint(parseInt(x) + 0.5, parseInt(y) + 0.5, parseInt(z) + 0.5, 0.45, 0xFFFFFF, 255, true)
                Hud.registerDraw3D(this.draw3D)
                this.currentRegex = this.START_REGEX
                break;
            default:
                break;
        }
    }

    static HandleMessage(recvMessageEvent) {
        TradeReader.instance.HandleMessage(recvMessageEvent)
    }

    HandleMaterialQuantityText(msg) {
        if (!msg) return;
        const { amount, material } = msg.match(this.MATERIAL_QUANTITY_REGEX).groups
        let direction = Object.hasOwn(this.trade, "input-material") ? "out" : "in"
        this.trade[`${direction}put-amount`] = amount
        this.trade[`${direction}put-material`] = material
    }

    SaveTrade() {
        let t = this.trade
        if (this.CSV_OUTPUT) {
            this.Write(`${t['input-amount']},${t['input-material']},${t['input-compacted']},${t['output-amount']},${t['output-material']},${t['output-compacted']},` +
                `${t['exchanges-available']}`)
            if (!!t['x'])
                this.Write(`,${t['x']},${t['y']},${t['z']}`)
            this.Write("\n")
        }
        this.exchangeList.push(this.trade)
        this.trade = {"input-compacted": false, "output-compacted": false}
    }


    Write(msg) {
        if (this.CSV_OUTPUT) {
            if (!FS.exists(this.TRADE_OUTPUT_FOLDER))
                FS.makeDir(this.TRADE_OUTPUT_FOLDER) ? {} : this.TRADE_OUTPUT_FOLDER = "" 
            FS.open(`${this.TRADE_OUTPUT_FOLDER}${this.TRADE_OUTPUT_FILE}.csv`).append(msg) // write trade string to log file
        }
    }

    WriteStockWarning() {
        const date = new Intl.DateTimeFormat('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        })

        let output = `Low Stock Detected (${date.format(new Date())}):\n\n`
        for (let i = 0; i < this.exchangeList.length; i++) {
            let trade = this.exchangeList[i]
            if (trade["exchanges-available"] > this.STOCK_WARNING_THRESHOLD) continue;
            output += `${trade["input-material"]} (${trade["current-index"]}/${trade["max-index"]})` +
                ` | ${trade["exchanges-available"]} Trades` +
                ` | X:${trade.x}, Y:${trade.y} Z:${trade.z}\n`
        }

        FS.unlink(this.STOCK_WARNING_OUTPUT_FILE)
        FS.open(this.STOCK_WARNING_OUTPUT_FILE).append(output)
    }
}

let reader = GlobalVars.getObject("TradeReader")

if (!!reader) {
    Chat.log("STOPPPING")
    reader.Stop()
    GlobalVars.remove('TradeReader')
} else {
    Chat.log("STARTING")
    reader = TradeReader.instance
    reader.Start()
    GlobalVars.putObject("TradeReader", reader)
}
