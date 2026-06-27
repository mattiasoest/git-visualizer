package app.gitvisualizer.events.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.io.IOException;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder;

import app.gitvisualizer.events.dto.EventView;

class EventBroadcasterTest {

	private EventBroadcaster broadcaster;

	@BeforeEach
	void setUp() {
		broadcaster = new EventBroadcaster();
	}

	@Test
	void sendToEmitterRemovesDeadEmitterWithoutThrowing() throws IOException {
		SseEmitter emitter = mock(SseEmitter.class);
		doThrow(new IllegalStateException("already completed"))
				.when(emitter)
				.send(any(SseEventBuilder.class));

		EventView event = new EventView("1", "PushEvent", "2026-06-13T12:00:01Z", null, null, "summary", null, null, null, null);

		assertThatCode(() -> broadcaster.sendToEmitter(emitter, event)).doesNotThrowAnyException();

		verify(emitter, never()).completeWithError(any());
	}

}
