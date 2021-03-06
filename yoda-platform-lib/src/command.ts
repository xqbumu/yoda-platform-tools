import * as adb from 'adbkit'
import * as path from 'path'

export interface IDBusConnection {
  service: string
  objectPath: string
  interface: string
}

export interface ICommandResult {
  ok?: boolean
  result?: any
  message?: string
  stack?: string
}

function generateDBusCommand (session: string, connection: IDBusConnection, methodName: string, args: any[]) {
  let cmd = [
    `dbus-send --print-reply=literal`,
    `--bus=${session}`,
    `--dest=${connection.service}`,
    `${connection.objectPath}`,
    `${connection.interface}.${methodName}`
  ]
  cmd = cmd.concat(args.map((arg: any) => {
    switch (typeof arg) {
      case 'number':
        return `double:${arg}`
      case 'string':
        return `string:${JSON.stringify(arg)}`
      case 'object':
        return `string:${JSON.stringify(JSON.stringify(arg))}`
      default:
        throw new Error(`Undefined transform of argument type ${typeof arg}`)
    }
  }))
  return cmd.join(' ')
}

export class PlatformSelector {
  private static client = adb.createClient()

  // eslint-disable-next-line no-useless-constructor
  private constructor () {}

  static async listDevices () {
    return this.client.listDevices()
  }
}

export class PlatformClient {
  client = adb.createClient()
  sessionAddress?: string

  // eslint-disable-next-line no-useless-constructor
  constructor (
    public deviceId: string,
    public connection: IDBusConnection
  ) {}

  async init () {
    await this.assertAvailability()
    this.sessionAddress = await this.getDBusSession()
  }

  async assertAvailability () {
    const version = await this.client.version()
    if (version < 40) {
      throw new Error(`Requires adb version >= 40, got ${version}`)
    }
    const dbusSendPath = await this.client.shell(this.deviceId, '/usr/bin/which dbus-send')
      .then(adb.util.readAll)
      .then((it: Buffer) => it.toString().trim())
    if (!path.isAbsolute(dbusSendPath)) {
      throw new Error('dbus-send is not available on device')
    }
  }

  async getDBusSession () {
    const output: Buffer = await this.client.shell(this.deviceId, 'cat /var/run/dbus/session')
      .then(adb.util.readAll)
    const match = output.toString().match(/DBUS_SESSION_BUS_ADDRESS=(.+)/)
    if (match == null) {
      throw new Error('Cannot determine dbus session address.')
    }
    return match[1]
  }

  generateCommand (command: string, args: any[]): string {
    return generateDBusCommand(this.sessionAddress!, this.connection, command, args)
  }

  async command (command: string, args: any[]): Promise<string> {
    const cmd = generateDBusCommand(this.sessionAddress!, this.connection, command, args)
    const output: Buffer = await this.client.shell(this.deviceId, cmd)
      .then(adb.util.readAll)
    return output.toString()
  }

  async jsonCommand (command: string, args: any[]): Promise<any> {
    const output = await this.command(command, args)
    let result: ICommandResult
    try {
      result = JSON.parse(output)
    } catch (err) {
      (err).data = output
      throw err
    }
    if (result.ok !== true) {
      const error: any = new Error(`Command Error: ${result.message}`)
      error.deviceStack = error.stack
      throw error
    }
    return result.result
  }
}
