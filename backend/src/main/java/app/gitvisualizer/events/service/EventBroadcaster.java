package app.gitvisualizer.events.service;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
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
	private final Map<SseEmitter, List<Runnable>> disconnectHandlers = new ConcurrentHashMap<>();

	public SseEmitter subscribe() {
		SseEmitter emitter = new SseEmitter(SSE_TIMEOUT);
		emitters.add(emitter);
		disconnectHandlers.put(emitter, new CopyOnWriteArrayList<>());

		Runnable cleanup = () -> removeEmitter(emitter);
		emitter.onCompletion(cleanup);
		emitter.onTimeout(cleanup);
		emitter.onError(ex -> removeEmitter(emitter));

		return emitter;
	}

	public void onDisconnect(SseEmitter emitter, Runnable handler) {
		List<Runnable> handlers = disconnectHandlers.get(emitter);
		if (handlers != null) {
			handlers.add(handler);
		}
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
		catch (IOException | IllegalStateException ex) {
			log.debug("Removing dead SSE emitter", ex);
			removeEmitter(emitter);
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
			catch (IOException | IllegalStateException ex) {
				log.debug("Removing dead SSE emitter during heartbeat", ex);
				removeEmitter(emitter);
			}
		}
	}

	private void removeEmitter(SseEmitter emitter) {
		emitters.remove(emitter);
		List<Runnable> handlers = disconnectHandlers.remove(emitter);
		if (handlers != null) {
			handlers.forEach(Runnable::run);
		}
	}
}
