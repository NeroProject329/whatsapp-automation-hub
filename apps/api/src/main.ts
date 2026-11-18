import "reflect-metadata";
import {
  Body,
  Catch,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  HttpException,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  ApiBody,
  ApiCookieAuth,
  ApiTags,
  DocumentBuilder,
  SwaggerModule,
} from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { OperatorRequest } from "./auth.js";
import { AdminGuard, bootstrapAdmin, login, logout } from "./auth.js";
import { cfg, cache, db, id, read, missing } from "./runtime.js";
import {
  consentInput,
  contactInput,
  contactDetail,
  grant,
  listContacts,
  optOut,
  saveContact,
} from "./contacts.js";
import { commitImport, previewImport, upload } from "./imports.js";
import {
  activateInput,
  approvalInput,
  campaignInput,
  templateInput,
  testInput,
  changeCampaign,
  createCampaign,
  previewCampaign,
  saveTemplate,
  testSend,
} from "./campaigns.js";
import {
  command,
  connectionInput,
  createConnection,
  detailConnection,
  listConnections,
} from "./connections.js";
import { dashboard } from "./reports.js";
import { log } from "@hub/core";
import { z } from "zod";

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});
const uid = (p: string) => read(id, p);
const page = (raw: unknown) =>
  read(z.coerce.number().int().min(1).max(10000).default(1), raw);
const payload = (schema: z.ZodType, required = true) =>
  ApiBody({ schema: z.toJSONSchema(schema) as never, required });

@ApiTags("Sessão")
@Controller("auth")
class AuthController {
  @Post("login")
  @HttpCode(200)
  @ApiBody({ schema: z.toJSONSchema(loginSchema) as never })
  login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() value: unknown,
  ) {
    const { email, password } = read(loginSchema, value);
    return login(req, res, email, password);
  }
  @Get("me")
  @UseGuards(AdminGuard)
  @ApiCookieAuth("admin")
  me(@Req() req: OperatorRequest) {
    return req.operator;
  }
  @Post("logout")
  @UseGuards(AdminGuard)
  @ApiCookieAuth("admin")
  @HttpCode(200)
  logout(
    @Req() req: OperatorRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return logout(req, res);
  }
}
@ApiTags("Operação")
@ApiCookieAuth("admin")
@UseGuards(AdminGuard)
@Controller()
class AdminController {
  @Get("dashboard") dash(@Query() q: unknown) {
    return dashboard(q);
  }
  @Get("settings") settings() {
    return {
      provider: cfg.PROVIDER,
      realSendEnabled: cfg.REAL_SEND_ENABLED === "true",
      testNumbersConfigured: cfg.TEST_NUMBERS.split(",").filter(Boolean).length,
      sendIntervalMs: cfg.SEND_INTERVAL_MS,
    };
  }
  @Get("contacts") contacts(@Query() q: unknown) {
    return listContacts(q);
  }
  @Post("contacts") @payload(contactInput) add(
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return saveContact(b, r.operator.id);
  }
  @Get("contacts/:id") contact(
    @Param("id") p: string,
    @Req() r: OperatorRequest,
  ) {
    return contactDetail(uid(p), r.operator.id);
  }
  @Patch("contacts/:id") @payload(contactInput) edit(
    @Param("id") p: string,
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return saveContact(b, r.operator.id, uid(p));
  }
  @Delete("contacts/:id") erase(
    @Param("id") p: string,
    @Req() r: OperatorRequest,
  ) {
    return optOut(uid(p), r.operator.id, true);
  }
  @Post("contacts/:id/consent") @payload(consentInput) consent(
    @Param("id") p: string,
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return grant(uid(p), b, r.operator.id);
  }
  @Post("contacts/:id/opt-out") suppress(
    @Param("id") p: string,
    @Req() r: OperatorRequest,
  ) {
    return optOut(uid(p), r.operator.id);
  }
  @Post("imports/contacts/preview") @payload(upload) importPreview(
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return previewImport(b, r.operator.id);
  }
  @Post("imports/contacts/:id/commit") importCommit(
    @Param("id") p: string,
    @Req() r: OperatorRequest,
  ) {
    return commitImport(uid(p), r.operator.id);
  }
  @Get("connections") connections() {
    return listConnections();
  }
  @Get("connections/:id") connection(@Param("id") p: string) {
    return detailConnection(uid(p));
  }
  @Post("connections") @payload(connectionInput) addConnection(
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return createConnection(b, r.operator.id);
  }
  @Post("connections/:id/:action") connectionCommand(
    @Param("id") p: string,
    @Param("action") a: string,
    @Req() r: OperatorRequest,
  ) {
    return command(uid(p), a, r.operator.id);
  }
  @Get("templates") templates() {
    return db.template.findMany({ take: 100, orderBy: { createdAt: "desc" } });
  }
  @Post("templates") @payload(templateInput) template(
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return saveTemplate(b, r.operator.id);
  }
  @Get("campaigns") campaigns(@Query("page") p: unknown) {
    return db.campaign.findMany({
      skip: (page(p) - 1) * 50,
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { connection: { select: { id: true, label: true } } },
    });
  }
  @Post("campaigns") @payload(campaignInput) create(
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return createCampaign(b, r.operator.id);
  }
  @Patch("campaigns/:id") @payload(campaignInput) editCampaign(
    @Param("id") p: string,
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return createCampaign(b, r.operator.id, uid(p));
  }
  @Get("campaigns/:id") async campaign(@Param("id") p: string) {
    const c = await db.campaign.findUnique({ where: { id: uid(p) } });
    if (!c) missing();
    const results = await db.dispatch.groupBy({
      by: ["state"],
      where: { campaignId: c.id },
      _count: true,
    });
    return {
      ...c,
      results: Object.fromEntries(results.map((s) => [s.state, s._count])),
    };
  }
  @Get("campaigns/:id/messages") messages(
    @Param("id") p: string,
    @Query("page") n: unknown,
  ) {
    return db.dispatch.findMany({
      where: { campaignId: uid(p) },
      take: 50,
      skip: (page(n) - 1) * 50,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        phone: true,
        state: true,
        code: true,
        submittedAt: true,
        deliveredAt: true,
        readAt: true,
      },
    });
  }
  @Get("campaigns/:id/preview") preview(@Param("id") p: string) {
    return previewCampaign(uid(p));
  }
  @Post("campaigns/:id/test-send") @payload(testInput) testSend(
    @Param("id") p: string,
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return testSend(uid(p), b, r.operator.id);
  }
  @Post("campaigns/:id/:action")
  @payload(z.union([approvalInput, activateInput]), false)
  change(
    @Param("id") p: string,
    @Param("action") a: string,
    @Body() b: unknown,
    @Req() r: OperatorRequest,
  ) {
    return changeCampaign(uid(p), a, b, r.operator.id);
  }
  @Get("logs") logs(@Query("page") n: unknown) {
    return db.audit.findMany({
      take: 50,
      skip: (page(n) - 1) * 50,
      orderBy: { at: "desc" },
    });
  }
  @Get("events") events(@Query("page") n: unknown) {
    return db.channelEvent.findMany({
      take: 50,
      skip: (page(n) - 1) * 50,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        connectionId: true,
        kind: true,
        contactId: true,
        text: true,
        contentType: true,
        occurredAt: true,
        createdAt: true,
      },
    });
  }
  @Get("messages") outgoing(@Query("page") n: unknown) {
    return db.dispatch.findMany({
      take: 50,
      skip: (page(n) - 1) * 50,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        campaignId: true,
        kind: true,
        phone: true,
        state: true,
        code: true,
        createdAt: true,
        submittedAt: true,
      },
    });
  }
}
@Controller("health")
class HealthController {
  @Get("live") live() {
    return { ok: true };
  }
  @Get("ready") async ready() {
    try {
      await Promise.all([db.$queryRaw`SELECT 1`, cache.ping()]);
      return { ok: true };
    } catch {
      throw new HttpException(
        {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Serviço temporariamente indisponível.",
        },
        503,
      );
    }
  }
}
@Global()
@Module({ providers: [AdminGuard], exports: [AdminGuard] })
class AuthModule {}
@Module({
  imports: [AuthModule],
  controllers: [AuthController, AdminController, HealthController],
})
class AppModule {}

@Catch()
class SafeErrors {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = error instanceof HttpException ? error.getStatus() : 500;
    const info = error instanceof HttpException ? error.getResponse() : null;
    const obj =
      info && typeof info === "object"
        ? (info as { code?: string; message?: unknown; details?: unknown })
        : {};
    if (code >= 500) log("api_error", obj.code ?? "INTERNAL");
    if (!res.headersSent)
      res.status(code).json({
        error: {
          code: obj.code ?? (code === 404 ? "NOT_FOUND" : "REQUEST_ERROR"),
          message:
            obj.code && typeof obj.message === "string"
              ? obj.message
              : code >= 500
                ? "Não foi possível concluir."
                : "Solicitação inválida.",
          details: obj.details,
          requestId: res.locals.requestId,
        },
      });
  }
}
async function main() {
  await db.$connect();
  await bootstrapAdmin();
  const app = await NestFactory.create(AppModule, {
    logger: false,
    bodyParser: false,
    abortOnError: false,
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
    cookieParser(),
  );
  app.use((_r: Request, res: Response, next: () => void) => {
    res.locals.requestId = randomUUID();
    res.set("X-Request-Id", res.locals.requestId);
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "3mb", inflate: false }));
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new SafeErrors());
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("WhatsApp Automation Hub")
      .setVersion("0.1")
      .addCookieAuth(
        cfg.HUB_MODE === "production" ? "__Host-hub" : "hub_local",
        { type: "apiKey" },
        "admin",
      )
      .build(),
  );
  app
    .getHttpAdapter()
    .get("/api/openapi.json", async (req: Request, res: Response) => {
      try {
        await new AdminGuard().canActivate({
          switchToHttp: () => ({ getRequest: () => req }),
        } as never);
        res.json(doc);
      } catch {
        res.status(401).json({
          error: {
            code: "SESSION_REQUIRED",
            message: "Entre para continuar.",
          },
        });
      }
    });
  await app.listen(cfg.API_PORT, cfg.API_HOST);
  log("api_listening");
  const close = async () => {
    await app.close();
    cache.disconnect();
    await db.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
main().catch(() => {
  log("api_start_failed");
  process.exit(1);
});
