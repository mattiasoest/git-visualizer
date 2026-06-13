package app.gitvisualizer.events.service;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.events.dto.EventView;

@Component
public class EventBroadcaster {

	private static final Logger log = LoggerFactory.getLogger(EventBroadcaster.class);
	private static final long SSE_TIMEOUT = 0L;

	private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

	public SseEmitter subscribe() {
		SseEmitter emitter = new SseEmitter(SSE_TIMEOUT);
		emitters.add(emitter);

		emitter.onCompletion(() -> emitters.remove(emitter));
		emitter.onTimeout(() -> emitters.remove(emitter));
		emitter.onError(ex -> emitters.remove(emitter));

		return emitter;
	}

	public void broadcast(EventView event) {
		for (SseEmitter emitter : emitters) {
			sendToEmitter(emitter, event);
		}
	}

	public void sendToEmitter(SseEmitter emitter, EventView event) {
		try {
			emitter.send(SseEmitter.event()
					.name("github-event")
					.data(event));
		}
		catch (IOException ex) {
			log.debug("Removing dead SSE emitter", ex);
			emitters.remove(emitter);
			emitter.completeWithError(ex);
		}
	}

	public void sendReplay(SseEmitter emitter, List<EventView> events) throws IOException {
		for (EventView event : events) {
			sendToEmitter(emitter, event);
		}
	}

	@Scheduled(fixedRate = 15_000)
	public void heartbeat() {
		for (SseEmitter emitter : emitters) {
			try {
				emitter.send(SseEmitter.event().comment("ping"));
			}
			catch (IOException ex) {
				emitters.remove(emitter);
				emitter.completeWithError(ex);
			}
		}
	}
}
