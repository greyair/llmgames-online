import { z } from "zod";

/** Local integration session files are parsed before installing browser cookies. */
export const sessionSeedSchema = z.array(
  z.object({ id: z.string().min(1), token: z.string().min(1), gamertag: z.string().min(1) }),
);
